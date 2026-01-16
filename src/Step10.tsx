import React, { useState, useEffect, useRef } from 'react';
import { Play, Mic, Volume2, Loader2, StopCircle, Zap, FileAudio, Square, Sliders, Download, Bot } from 'lucide-react';

// --- WAV Encoder (Utility) ---
const bufferToWav = (buffer: AudioBuffer) => {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArr = new ArrayBuffer(length);
  const view = new DataView(bufferArr);
  const channels = [];
  let i, sample, offset = 0, pos = 0;

  setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157); 
  setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
  setUint32(buffer.sampleRate); setUint32(buffer.sampleRate * 2 * numOfChan); 
  setUint16(numOfChan * 2); setUint16(16); 
  setUint32(0x61746164); setUint32(length - pos - 4); 

  for(i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));

  while(pos < buffer.length) {
    for(i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][pos])); 
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; 
      view.setInt16(44 + offset, sample, true); offset += 2;
    }
    pos++;
  }
  return new Blob([view], { type: 'audio/wav' });
  function setUint16(data: any) { view.setUint16(pos, data, true); pos += 2; }
  function setUint32(data: any) { view.setUint32(pos, data, true); pos += 4; }
};

// --- Signal Processing Helpers ---

const resample = (input: Float32Array, targetLength: number) => {
  if (targetLength <= 0) return new Float32Array(0);
  const output = new Float32Array(targetLength);
  const step = input.length / targetLength;
  for (let i = 0; i < targetLength; i++) {
    const pos = i * step;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const p0 = input[idx] || 0;
    const p1 = input[idx + 1] || p0; 
    output[i] = p0 * (1 - frac) + p1 * frac;
  }
  return output;
};

// Basic Energy Calculation
const calculateEnergy = (frame: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return sum / frame.length;
};

// Simple Autocorrelation Pitch Detection
const estimatePitch = (frame: Float32Array, sampleRate: number) => {
  const n = frame.length;
  const minFreq = 80; const maxFreq = 600;
  const minPeriod = Math.floor(sampleRate / maxFreq);
  const maxPeriod = Math.floor(sampleRate / minFreq);
  
  let bestPeriod = 0; 
  let maxCorr = -1.0;

  for (let lag = minPeriod; lag <= maxPeriod; lag++) {
    if (lag >= n) break; 
    let sum = 0;
    for (let i = 0; i < n - lag; i++) {
      sum += frame[i] * frame[i + lag];
    }
    
    // Simple normalization to avoid loudness bias, but prone to errors
    // (Step 14 uses much more robust normalization)
    if (sum > maxCorr) { 
        maxCorr = sum; 
        bestPeriod = lag; 
    }
  }
  
  const pitch = (bestPeriod > 0) ? sampleRate / bestPeriod : 0;
  return { pitch, periodicity: maxCorr }; // periodicity is raw correlation here
};

// Standard LPC Analysis (No Lag Windowing, No Bandwidth Expansion)
const computeLPCStandard = (signal: Float32Array, order: number) => {
  const n = signal.length;
  const R = new Float32Array(order + 1);
  
  // Autocorrelation
  for (let k = 0; k <= order; k++) {
    let sum = 0;
    for (let i = 0; i < n - k; i++) sum += signal[i] * signal[i + k];
    R[k] = sum;
  }
  
  // Levinson-Durbin Recursion
  const a = new Float32Array(order + 1);
  a.fill(0); a[0] = 1.0;
  let E = R[0];

  for (let k = 0; k < order; k++) {
    let lambda = 0;
    for (let j = 0; j <= k; j++) lambda += a[j] * R[k + 1 - j];
    if (Math.abs(E) < 1e-10) break;
    const alpha = -lambda / E;
    
    for (let j = 0; j <= (k + 1) / 2; j++) {
      const temp = a[j] + alpha * a[k + 1 - j];
      if (j !== k + 1 - j) a[k + 1 - j] += alpha * a[j];
      a[j] = temp;
    }
    E *= (1 - alpha * alpha);
  }
  return a;
};


const SAMPLES = [
    { name: 'Sample 1', file: 'game-over-deep-male-voice-clip-352695.mp3' },
    { name: 'Sample 2', file: 'good-boy-male-voice-praise-352699.mp3' },
    { name: 'Sample 3', file: 'medieval-gamer-voice-why-would-you-not-subscribe-226580.mp3' }
];

// --- Main Component ---
const VoiceChangerStep10 = () => {
  // Config
  const [pitchShiftRatio, setPitchShiftRatio] = useState(1.45); 
  const [formantShiftRatio, setFormantShiftRatio] = useState(1.0); // Step 10 often just shifts pitch
  const [lpcOrder, setLpcOrder] = useState(32); 
  
  // Processing State
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [originalBuffer, setOriginalBuffer] = useState<AudioBuffer | null>(null);
  const [processedBuffer, setProcessedBuffer] = useState<AudioBuffer | null>(null);
  
  const [recording, setRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlayingResult, setIsPlayingResult] = useState(false); 
  const [message, setMessage] = useState("LPC Only (Robotic Voice)");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    setAudioContext(ctx);
    return () => { ctx.close(); };
  }, []);

  const resumeContext = async () => {
    if (audioContext && audioContext.state === 'suspended') {
      try { await audioContext.resume(); } catch (e) {}
    }
  };

  const startRecordingFixed = async () => {
    if (!audioContext) return;
    await resumeContext();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const arrayBuffer = await blob.arrayBuffer();
        const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
        setOriginalBuffer(decodedBuffer);
        drawWaveform(decodedBuffer, canvasRef.current, "rgb(100, 200, 255)");
        setMessage("Recording finished. Please process.");
        setProcessedBuffer(null);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setMessage("Recording...");
    } catch (err) { setMessage("Mic Error: " + err); }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !audioContext) return;
    await resumeContext();
    setIsProcessing(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
      setOriginalBuffer(decodedBuffer);
      drawWaveform(decodedBuffer, canvasRef.current, "rgb(100, 200, 255)");
      setMessage(`Loaded: ${file.name}`);
      setProcessedBuffer(null);
    } catch (e) { setMessage("File Error"); }
    finally { setIsProcessing(false); if(fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const loadSampleAudio = async (filename: string) => {
    if (!audioContext) return;
    await resumeContext();
    setIsProcessing(true);
    try {
      // Force correct path for GitHub Pages
      const isGithub = window.location.hostname.includes('github.io');
      const basePath = isGithub ? '/voicechanger_cbd/' : '/';
      const url = `${basePath}${filename}`;

      console.log(`Loading audio from: ${url}`);
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} url: ${url}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
      setOriginalBuffer(decodedBuffer);
      if (canvasRef.current) drawWaveform(decodedBuffer, canvasRef.current, "rgb(100, 200, 255)");
      setMessage(`Sample Loaded: ${filename}`);
      setProcessedBuffer(null);
    } catch (err) {
      setMessage("Load Failed: " + String(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const playAudio = async (buffer: AudioBuffer | null) => {
    if (!audioContext || !buffer) return;
    
    await resumeContext();

    if (sourceRef.current) { try { sourceRef.current.stop(); } catch(e) {} }
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.onended = () => setIsPlayingResult(false);
    source.start();
    sourceRef.current = source;
    setIsPlayingResult(true);
  };
  const stopAudio = () => { if (sourceRef.current) { try { sourceRef.current.stop(); } catch(e) {} setIsPlayingResult(false); }};

  const downloadAudio = () => {
      if (!processedBuffer) return;
      const wavBlob = bufferToWav(processedBuffer);
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'voice_changer_robotic.wav';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  const testSpeakers = async () => {
    let ctx = audioContext;
    if (!ctx || ctx.state === 'closed') {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        ctx = new Ctx();
        setAudioContext(ctx);
        addLog("Created new AudioContext");
    }
  };

  // --- CORE PROCESSING STEP 10 (THE ROBOTIC ONE) ---
  const processAudio = async () => {
    if (!audioContext || !originalBuffer) return;
    await resumeContext();

    setIsProcessing(true);
    setMessage("Processing (LPC Robot)...");
    await new Promise(r => setTimeout(r, 10));

    const rawInput = originalBuffer.getChannelData(0);
    const inputData = new Float32Array(rawInput.length);
    inputData.set(rawInput);
    
    for(let i=1; i<rawInput.length; i++) {
        inputData[i] = rawInput[i] - 0.95 * rawInput[i-1];
    }
    
    // Params
    const frameSize = 512; // Smaller frame size can sound more "buzzy"
    const hopSize = 256; 
    const order = lpcOrder;
    
    // Windowing (Hamming)
    const window = new Float32Array(frameSize);
    for(let i=0; i<frameSize; i++) window[i] = 0.54 - 0.46 * Math.cos(2*Math.PI*i/(frameSize-1));

    const tempBufferLen = Math.floor(inputData.length * 2.0); 
    const outputData = new Float32Array(tempBufferLen);
    
    // State
    const synthFilterState = new Float32Array(order).fill(0);
    
    let phase = 0;
    const excitationPitchRatio = pitchShiftRatio; // Ignoring formant shift for classic robot effect
    
    const energyThreshold = 0.001; 
    let outPtr = 0;
    let lastPitch = 150;

    for (let i = 0; i < inputData.length - frameSize; i += hopSize) {
      const frame = new Float32Array(frameSize);
      for(let j=0; j<frameSize; j++) frame[j] = inputData[i+j] * window[j];

      // 1. Standard LPC Analysis
      // (No Lag Windowing, No Bandwidth Expansion)
      const a = computeLPCStandard(frame, order); 

      const energy = calculateEnergy(frame);
      const { pitch } = estimatePitch(frame, sampleRate);
      
      let isVoiced = false;
      if (energy > energyThreshold && pitch > 0) {
          isVoiced = true;
          lastPitch = pitch;
      }
      
      // Calculate Gain (G)
      // G = sqrt(Energy) is simple approx
      const gain = Math.sqrt(energy);

      // Synthesis Setup
      // Use last known pitch if voiced, otherwise random or fixed
      const f0 = (isVoiced ? lastPitch : 100) * excitationPitchRatio; 
      const periodSamples = sampleRate / f0;
      
      // Generate Excitation
      const excitation = new Float32Array(hopSize);

      for(let j=0; j<hopSize; j++) {
          
          let excSample = 0;

          if (isVoiced) {
             // ★ THE ROBOTIC SOURCE ★
             // Simple Impulse Train (Buzz)
             phase += 1.0;
             if (phase >= periodSamples) {
                 phase -= periodSamples;
                 excSample = 1.0; // Sharp impulse!
             } else {
                 excSample = 0.0;
             }
             // Scale impulse to maintain energy
             // Impulse needs huge gain because it's only 1 sample
             excSample *= Math.sqrt(periodSamples); 

          } else {
             // White Noise for unvoiced
             excSample = (Math.random() - 0.5) * 2.0;
          }

          excitation[j] = excSample * gain;
      }

      // 2. Standard LPC Synthesis Filter (All-Pole IIR)
      // No Bandwidth Expansion applied to 'a' here!
      // This means poles are very close to unit circle -> Sharp metallic resonance.
      
      for(let j=0; j<hopSize; j++) {
          if (outPtr >= outputData.length) break;
          
          let predicted = 0;
          for(let k=1; k<=order; k++) predicted -= a[k] * synthFilterState[k-1];
          
          let outSample = excitation[j] + predicted;
          
          // Basic stability clamp
          if (!isFinite(outSample) || Math.abs(outSample) > 10.0) {
             synthFilterState.fill(0);
             outSample = 0;
          } else {
             for (let k = order - 1; k > 0; k--) synthFilterState[k] = synthFilterState[k - 1];
             synthFilterState[0] = outSample;
             outputData[outPtr] = outSample; // No soft clipping
          }
          outPtr++;
      }
    }

    // Post Processing (Simple Resampling only if needed)
    // Step 10 usually assumes constant frame rate
    const finalData = outputData.slice(0, outPtr);

    // Normalize
    let maxPeak = 0;
    let hasNaN = false;
    for(let i=0; i<finalData.length; i++) {
        const val = Math.abs(finalData[i]);
        if (Number.isNaN(val)) hasNaN = true;
        else maxPeak = Math.max(maxPeak, val);
    }

    if (maxPeak > 0.001) {
        const normGain = 0.9 / maxPeak;
        for(let i=0; i<finalData.length; i++) finalData[i] *= normGain;
    }

    const outBuf = audioContext.createBuffer(1, finalData.length, sampleRate);
    outBuf.getChannelData(0).set(finalData);
    
    setProcessedBuffer(outBuf);
    setIsProcessing(false);
    setMessage("Conversion Complete (Robotic Voice)");
  };

  const drawWaveform = (buffer: AudioBuffer, canvas: HTMLCanvasElement | null, color: string) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const amp = height / 2;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#1f2937'; ctx.fillRect(0, 0, width, height);
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1;
    for (let i = 0; i < width; i++) {
      let min = 1.0, max = -1.0;
      for (let j = 0; j < step; j++) {
        const idx = i * step + j;
        if(idx < data.length) {
            if (data[idx] < min) min = data[idx];
            if (data[idx] > max) max = data[idx];
        }
      }
      ctx.moveTo(i, (1 - Math.min(1, max)) * amp);
      ctx.lineTo(i, (1 - Math.max(-1, min)) * amp);
    }
    ctx.stroke();
  };

  return (
    <div className="p-4 max-w-3xl mx-auto bg-gray-50 min-h-screen font-sans text-gray-800">
      <header className="mb-6 border-b pb-4">
        <h1 className="text-2xl font-bold flex items-center gap-2 text-gray-700">
          <Bot className="w-6 h-6" />
          Step 10: Robotic LPC (v2)
        </h1>
        <p className="text-gray-600 mt-2 text-sm">
          教科書通りの単純なLPC分析合成。帯域幅拡大や人間的な音源補正を行わないため、
          鋭い共鳴とブザーのような機械音になります（比較用）。
        </p>
      </header>

      {/* Input */}
      <div className="bg-white p-5 rounded-xl shadow-sm mb-6">
         <h2 className="font-bold text-lg mb-3 flex items-center gap-2"><Mic className="w-4 h-4"/> 音声入力</h2>
         <div className="flex flex-wrap gap-3 mb-4">
            {!recording ? (
                <button onClick={startRecordingFixed} className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-full flex items-center gap-2 shadow transition">
                  <Mic className="w-4 h-4" /> 録音開始
                </button>
            ) : (
                <button onClick={stopRecording} className="bg-gray-800 hover:bg-gray-900 text-white px-6 py-2 rounded-full flex items-center gap-2 animate-pulse shadow transition">
                  <StopCircle className="w-4 h-4" /> 停止
                </button>
            )}
            <input type="file" accept="audio/*" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-gray-50 text-sm">
                <FileAudio className="w-4 h-4" /> ファイル
            </button>

            <div className="flex flex-wrap gap-2 items-center ml-2 pl-2 border-l border-gray-200">
                <span className="text-xs text-gray-400 font-bold">SAMPLES:</span>
                {SAMPLES.map((sample) => (
                    <button 
                        key={sample.file} 
                        onClick={() => loadSampleAudio(sample.file)} 
                        className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs px-2 py-1.5 rounded border border-gray-200 transition"
                    >
                        {sample.name}
                    </button>
                ))}
            </div>
            {originalBuffer && (
                <button onClick={() => playAudio(originalBuffer)} className="text-gray-600 font-bold text-sm flex items-center gap-1 hover:underline">
                    <Volume2 className="w-4 h-4"/> 原音再生
                </button>
            )}
         </div>
         <div className="bg-gray-900 rounded h-20 w-full relative">
            <canvas ref={canvasRef} width={600} height={80} className="w-full h-full" />
         </div>
      </div>

      {/* Controls */}
      <div className="bg-white p-5 rounded-xl shadow-sm mb-6">
        <h2 className="font-bold text-lg mb-3 flex items-center gap-2"><Sliders className="w-4 h-4"/> パラメータ</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
                <label className="flex justify-between text-sm font-semibold mb-1 text-gray-700">
                    <span>ピッチ (x1.45)</span>
                    <span>x{pitchShiftRatio.toFixed(2)}</span>
                </label>
                <input type="range" min="0.5" max="2.0" step="0.05" value={pitchShiftRatio} onChange={e => setPitchShiftRatio(Number(e.target.value))} className="w-full accent-gray-600"/>
            </div>
            <div>
                <label className="flex justify-between text-sm font-semibold mb-1 text-gray-700">
                    <span>LPC解像度</span>
                    <span>{lpcOrder}</span>
                </label>
                <input type="range" min="16" max="64" step="4" value={lpcOrder} onChange={e => setLpcOrder(Number(e.target.value))} className="w-full accent-gray-600"/>
            </div>
        </div>

        <button 
            onClick={processAudio} 
            disabled={!originalBuffer || isProcessing}
            className={`mt-6 w-full py-3 rounded-lg font-bold text-white flex justify-center items-center gap-2 transition ${!originalBuffer ? 'bg-gray-300' : 'bg-gray-700 hover:bg-gray-800 shadow-lg'}`}
        >
            {isProcessing ? <Loader2 className="animate-spin" /> : <Zap />}
            変換実行 (Robotic)
        </button>
      </div>

      {/* Output */}
      <div className="bg-white p-5 rounded-xl shadow-sm border-t-4 border-gray-500">
         <h2 className="font-bold text-lg mb-3 flex items-center gap-2"><Volume2 className="w-4 h-4"/> 変換結果</h2>
         <div className="flex justify-center gap-4">
            {processedBuffer ? (
                <>
                {isPlayingResult ? (
                    <button onClick={stopAudio} className="bg-red-500 hover:bg-red-600 text-white px-8 py-3 rounded-full font-bold shadow-lg flex items-center gap-2">
                        <Square className="fill-current w-4 h-4" /> 停止
                    </button>
                ) : (
                    <button onClick={() => playAudio(processedBuffer)} className="bg-gray-700 hover:bg-gray-800 text-white px-8 py-3 rounded-full font-bold shadow-lg flex items-center gap-2 transform hover:scale-105 transition">
                        <Play className="fill-current" /> 結果を再生
                    </button>
                )}
                <button onClick={downloadAudio} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-full font-bold shadow-lg flex items-center gap-2">
                     <Download className="w-4 h-4" /> 保存
                </button>
                <button
                   onClick={testSpeakers}
                   className="px-4 py-3 bg-gray-600 text-white rounded hover:bg-gray-700 font-bold text-sm flex items-center gap-2"
                >
                   🔊 テスト音
                </button>
                </>
            ) : (
                <div className="text-gray-400 text-sm bg-gray-100 px-4 py-2 rounded">変換待ち...</div>
            )}
         </div>

         {/* Debug Log Container - Forced Visible */}
         <div className="mt-4 w-full p-2 bg-black text-green-400 font-mono text-xs rounded border border-gray-700 overflow-y-auto max-h-32">
            <div className="font-bold border-b border-gray-700 mb-1">Debug Output:</div>
            {debugLogs.length === 0 ? <div>(No logs yet)</div> : debugLogs.map((log, i) => (
                <div key={i} className="whitespace-pre-wrap">{log}</div>
            ))}
         </div>
      </div>
    </div>
  );
};

export default VoiceChangerStep10;