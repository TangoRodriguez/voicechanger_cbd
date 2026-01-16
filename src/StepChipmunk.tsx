import React, { useState, useRef, useEffect } from 'react';
import { Mic, Upload, Play, Square, Download, StopCircle, Sliders, Music, Zap } from 'lucide-react';

const SAMPLES = [
    { name: 'Sample 1', file: 'game-over-deep-male-voice-clip-352695.mp3' },
    { name: 'Sample 2', file: 'good-boy-male-voice-praise-352699.mp3' },
    { name: 'Sample 3', file: 'medieval-gamer-voice-why-would-you-not-subscribe-226580.mp3' }
];

const VoiceChangerChipmunk = () => {
  const [pitchRatio, setPitchRatio] = useState(1.5); 
  
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [originalBuffer, setOriginalBuffer] = useState<AudioBuffer | null>(null);
  const [processedBuffer, setProcessedBuffer] = useState<AudioBuffer | null>(null);
  const [recording, setRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlayingResult, setIsPlayingResult] = useState(false); 
  const [message, setMessage] = useState("Simple Chipmunk Effect (Speed & Pitch up)");

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

  const startRecording = async () => {
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
        setMessage("Recording done.");
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
    try {
      const arrayBuffer = await file.arrayBuffer();
      const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
      setOriginalBuffer(decodedBuffer);
      drawWaveform(decodedBuffer, canvasRef.current, "rgb(100, 200, 255)");
      setMessage(`Loaded: ${file.name}`);
      setProcessedBuffer(null);
    } catch (e) { setMessage("File Error"); }
    finally { if(fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const loadSampleAudio = async (filename: string) => {
    if (!audioContext) return;
    await resumeContext();
    try {
      const isGithub = window.location.hostname.includes('github.io');
      const basePath = isGithub ? '/voicechanger_cbd/' : '/';
      const url = `${basePath}${filename}`;
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
      setOriginalBuffer(decodedBuffer);
      if (canvasRef.current) drawWaveform(decodedBuffer, canvasRef.current, "rgb(100, 200, 255)");
      setMessage(`Loaded Sample: ${filename}`);
      setProcessedBuffer(null);
    } catch (err) { setMessage("Load Failed: " + String(err)); }
  };

  const processAudio = async () => {
    if (!audioContext || !originalBuffer) return;
    setIsProcessing(true);
    setMessage("Processing (Resampling)...");
    
    // Offline rendering for "Chipmunk" (Resampling)
    // New Length = Old Length / Rate
    const newLength = Math.ceil(originalBuffer.length / pitchRatio);
    const offlineCtx = new OfflineAudioContext(originalBuffer.numberOfChannels, newLength, originalBuffer.sampleRate);
    
    const source = offlineCtx.createBufferSource();
    source.buffer = originalBuffer;
    source.playbackRate.value = pitchRatio;
    source.connect(offlineCtx.destination);
    source.start();
    
    const renderedBuffer = await offlineCtx.startRendering();
    setProcessedBuffer(renderedBuffer);
    setIsProcessing(false);
    setMessage("Chipmunk conversion done!");
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

  const bufferToWav = (buffer: AudioBuffer) => {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const bufferArray = new ArrayBuffer(length);
    const view = new DataView(bufferArray);
    const channels = [];
    let i;
    let sample;
    let offset = 0;
    let pos = 0;
  
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"
  
    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(buffer.sampleRate);
    setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2); // block-align
    setUint16(16); // 16-bit (hardcoded in this writing loop)
  
    setUint32(0x61746164); // "data" - chunk
    setUint32(length - pos - 4); // chunk length
  
    for(i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
  
    while(pos < buffer.length) {
      for(i = 0; i < numOfChan; i++) {
        sample = Math.max(-1, Math.min(1, channels[i][pos])); 
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0;
        view.setInt16(44 + offset, sample, true); 
        offset += 2;
      }
      pos++;
    }
  
    return new Blob([bufferArray], { type: 'audio/wav' });
  
    function setUint16(data: any) { view.setUint16(pos, data, true); pos += 2; }
    function setUint32(data: any) { view.setUint32(pos, data, true); pos += 4; }
  };

  const downloadAudio = () => {
    if (!processedBuffer) return;
    const wavBlob = bufferToWav(processedBuffer);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chipmunk.wav';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
          <Music className="w-6 h-6" />
          Chipmunk Effect
        </h1>
        <p className="text-gray-600 mt-2 text-sm">
          Basic pitch shift by changing playback speed. (Like a record player spinning faster)
        </p>
      </header>

      {/* Input */}
      <div className="bg-white p-5 rounded-xl shadow-sm mb-6">
         <h2 className="font-bold text-lg mb-3 flex items-center gap-2"><Mic className="w-4 h-4"/> Input</h2>
         <div className="flex flex-wrap gap-3 mb-4">
            {!recording ? (
                <button onClick={startRecording} className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-full flex items-center gap-2 shadow transition">
                  <Mic className="w-4 h-4" /> Record
                </button>
            ) : (
                <button onClick={stopRecording} className="bg-gray-800 hover:bg-gray-900 text-white px-6 py-2 rounded-full flex items-center gap-2 animate-pulse shadow transition">
                  <StopCircle className="w-4 h-4" /> Stop
                </button>
            )}
            <input type="file" accept="audio/*" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-gray-50 text-sm">
                <Upload className="w-4 h-4" /> File
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
                <button onClick={() => playAudio(originalBuffer)} className="text-gray-600 font-bold text-sm flex items-center gap-1 hover:underline ml-4">
                    <Play className="w-4 h-4"/> Org
                </button>
            )}
         </div>
         <div className="bg-gray-900 rounded h-20 w-full relative">
            <canvas ref={canvasRef} width={600} height={80} className="w-full h-full" />
         </div>
      </div>

      {/* Controls */}
      <div className="bg-white p-5 rounded-xl shadow-sm mb-6">
        <h2 className="font-bold text-lg mb-3 flex items-center gap-2"><Sliders className="w-4 h-4"/> Parameters</h2>
        <div className="mb-4">
            <label className="flex justify-between text-sm font-semibold mb-1 text-gray-700">
                <span>Pitch (Speed) (x1.5)</span>
                <span>x{pitchRatio.toFixed(2)}</span>
            </label>
            <input type="range" min="0.5" max="3.0" step="0.1" value={pitchRatio} onChange={e => setPitchRatio(Number(e.target.value))} className="w-full accent-blue-600"/>
        </div>

        <button 
            onClick={processAudio} 
            disabled={!originalBuffer || isProcessing}
            className={`mt-6 w-full py-3 rounded-lg font-bold text-white flex justify-center items-center gap-2 transition ${!originalBuffer ? 'bg-gray-300' : 'bg-blue-600 hover:bg-blue-700 shadow-lg'}`}
        >
            {isProcessing ? <Zap className="animate-spin" /> : <Zap />}
            Convert
        </button>
      </div>

      {/* Output */}
      <div className="bg-white p-5 rounded-xl shadow-sm border-t-4 border-blue-500">
         <h2 className="font-bold text-lg mb-3 flex items-center gap-2"><Play className="w-4 h-4"/> Result</h2>
         <div className="flex justify-center gap-4">
            {processedBuffer ? (
                <>
                {isPlayingResult ? (
                    <button onClick={stopAudio} className="bg-red-500 hover:bg-red-600 text-white px-8 py-3 rounded-full font-bold shadow-lg flex items-center gap-2">
                        <Square className="fill-current w-4 h-4" /> Stop
                    </button>
                ) : (
                    <button onClick={() => playAudio(processedBuffer)} className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-full font-bold shadow-lg flex items-center gap-2 transform hover:scale-105 transition">
                        <Play className="fill-current" /> Play
                    </button>
                )}
                <button onClick={downloadAudio} className="bg-gray-600 hover:bg-gray-700 text-white px-6 py-3 rounded-full font-bold shadow-lg flex items-center gap-2">
                     <Download className="w-4 h-4" /> Save
                </button>
                </>
            ) : (
                <div className="text-gray-400 text-sm bg-gray-100 px-4 py-2 rounded">Waiting...</div>
            )}
         </div>
      </div>
    </div>
  );
};

export default VoiceChangerChipmunk;
