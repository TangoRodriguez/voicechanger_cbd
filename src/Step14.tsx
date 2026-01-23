import React, { useState, useEffect, useRef } from 'react';
import { Play, Mic, Volume2, Loader2, StopCircle, Zap, FileAudio, Square, Sliders, Download, Sparkles, User, Heart } from 'lucide-react';

// --- WAV Encoder ---
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

const SAMPLES = [
    { name: 'Sample 1', file: 'game-over-deep-male-voice-clip-352695.mp3' },
    { name: 'Sample 2', file: 'good-boy-male-voice-praise-352699.mp3' },
    { name: 'Sample 3', file: 'medieval-gamer-voice-why-would-you-not-subscribe-226580.mp3' }
];

// --- Signal Processing Helpers ---

class BiquadFilter {
    a0: number; a1: number; a2: number; b0: number; b1: number; b2: number;
    x1: number = 0; x2: number = 0; y1: number = 0; y2: number = 0;

    constructor(type: number, freq: number, sampleRate: number, Q: number, gainDB: number) {
        const w0 = 2 * Math.PI * freq / sampleRate;
        const cosw0 = Math.cos(w0);
        const sinw0 = Math.sin(w0);
        const alpha = sinw0 / (2 * Q);
        const A = Math.pow(10, gainDB / 40);

        this.a0 = 0; this.a1 = 0; this.a2 = 0; this.b0 = 0; this.b1 = 0; this.b2 = 0;

        switch (type) {
            case 3: // LowShelf
                {
                    const temp = 2 * Math.sqrt(A) * alpha;
                    this.b0 = A * ((A + 1) - (A - 1) * cosw0 + temp);
                    this.b1 = 2 * A * ((A - 1) - (A + 1) * cosw0);
                    this.b2 = A * ((A + 1) - (A - 1) * cosw0 - temp);
                    this.a0 = (A + 1) + (A - 1) * cosw0 + temp;
                    this.a1 = -2 * ((A - 1) + (A + 1) * cosw0);
                    this.a2 = (A + 1) + (A - 1) * cosw0 - temp;
                }
                break;
            case 4: // HighShelf
                {
                    const temp = 2 * Math.sqrt(A) * alpha;
                    this.b0 = A * ((A + 1) + (A - 1) * cosw0 + temp);
                    this.b1 = -2 * A * ((A - 1) + (A + 1) * cosw0);
                    this.b2 = A * ((A + 1) + (A - 1) * cosw0 - temp);
                    this.a0 = (A + 1) - (A - 1) * cosw0 + temp;
                    this.a1 = 2 * ((A - 1) - (A + 1) * cosw0);
                    this.a2 = (A + 1) - (A - 1) * cosw0 - temp;
                }
                break;
            case 1: // HighPass
                 {
                    this.b0 = (1 + cosw0) / 2;
                    this.b1 = -(1 + cosw0);
                    this.b2 = (1 + cosw0) / 2;
                    this.a0 = 1 + alpha;
                    this.a1 = -2 * cosw0;
                    this.a2 = 1 - alpha;
                 }
                 break;
            case 6: // Peaking
                {
                    this.b0 = 1 + alpha * A;
                    this.b1 = -2 * cosw0;
                    this.b2 = 1 - alpha * A;
                    this.a0 = 1 + alpha / A;
                    this.a1 = -2 * cosw0;
                    this.a2 = 1 - alpha / A;
                }
                break;
            default: this.b0 = 1; this.a0 = 1; break;
        }
        this.b0 /= this.a0; this.b1 /= this.a0; this.b2 /= this.a0;
        this.a1 /= this.a0; this.a2 /= this.a0;
    }

    process(input: number) {
        const output = this.b0 * input + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1; this.x1 = input;
        this.y2 = this.y1; this.y1 = output;
        return output;
    }
}

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

// Soft Pulse (Less buzzy than Rosenberg)
// A smoothed triangular-ish pulse
const softPulse = (t: number) => {
  if (t < 0 || t >= 1) return 0;
  // Smoother rise and fall
  return 0.5 * Math.sin(2 * Math.PI * t); 
};

const calculateEnergy = (frame: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return sum / frame.length;
};

const calculateZCR = (frame: Float32Array) => {
    let zcr = 0;
    for (let i = 1; i < frame.length; i++) {
        if ((frame[i] >= 0 && frame[i-1] < 0) || (frame[i] < 0 && frame[i-1] >= 0)) {
            zcr++;
        }
    }
    return zcr / (frame.length - 1);
};

const estimatePitchRobust = (frame: Float32Array, sampleRate: number) => {
  const n = frame.length;
  const minFreq = 80; const maxFreq = 600;
  const minPeriod = Math.floor(sampleRate / maxFreq);
  const maxPeriod = Math.floor(sampleRate / minFreq);
  
  let bestPeriod = 0; 
  let maxNormCorr = -1.0;

  for (let lag = minPeriod; lag <= maxPeriod; lag++) {
    if (lag >= n) break; 
    let sumXY = 0; let sumXX = 0; let sumYY = 0;
    for (let i = 0; i < n - lag; i++) {
      const x = frame[i]; 
      const y = frame[i + lag];
      sumXY += x * y; 
      sumXX += x * x; 
      sumYY += y * y;
    }
    
    if (sumXX * sumYY > 1e-9) {
        const normCorr = sumXY / Math.sqrt(sumXX * sumYY);
        const weightedCorr = normCorr * (1.0 - 0.1 * (lag / maxPeriod));
        
        if (weightedCorr > maxNormCorr) { 
            maxNormCorr = weightedCorr; 
            bestPeriod = lag; 
        }
    }
  }
  
  const pitch = (bestPeriod > 0) ? sampleRate / bestPeriod : 0;
  return { pitch, periodicity: maxNormCorr };
};

const getMedian = (values: number[]) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(values.length / 2)];
};

const computeLPCAndRef = (signal: Float32Array, order: number) => {
  const n = signal.length;
  const R = new Float32Array(order + 1);
  for (let k = 0; k <= order; k++) {
    let sum = 0;
    for (let i = 0; i < n - k; i++) sum += signal[i] * signal[i + k];
    R[k] = sum;
  }
  
  // Stronger lag window for stability
  const lagWindowWidth = 240.0; // Widened window for higher stability at high orders
  const fs = 44100;
  for (let k = 0; k <= order; k++) {
      const w = Math.exp(-0.5 * Math.pow((2 * Math.PI * lagWindowWidth * k) / fs, 2));
      R[k] *= w;
  }
  
  R[0] *= 1.015; // Increased Noise floor for stability
  
  const a = new Float32Array(order + 1);
  a.fill(0); a[0] = 1.0;
  let E = R[0];
  
  for (let k = 0; k < order; k++) {
    let lambda = 0;
    for (let j = 0; j <= k; j++) lambda += a[j] * R[k + 1 - j];
    
    // Safety for stability
    let alpha = -lambda / (E + 1e-10);
    if (alpha > 0.995) alpha = 0.995;
    if (alpha < -0.995) alpha = -0.995;

    for (let j = 0; j <= (k + 1) / 2; j++) {
      const temp = a[j] + alpha * a[k + 1 - j];
      if (j !== k + 1 - j) a[k + 1 - j] += alpha * a[j];
      a[j] = temp;
    }
    E *= (1 - alpha * alpha);
  }
  return a;
};


// --- Main Component ---
const VoiceChangerStep14 = () => {
  // Basic - Updated for Natural Tone (Less Chipmunk)
  const [pitchShiftRatio, setPitchShiftRatio] = useState(1.55); 
  const [formantShiftRatio, setFormantShiftRatio] = useState(1.15); 
  
  // Voice Quality
  const [voicingSensitivity, setVoicingSensitivity] = useState(0.65); 
  const [pulseGainBoost, setPulseGainBoost] = useState(1.75); 
  const [lpcOrder, setLpcOrder] = useState(60); 
  const [bandwidthExpansion, setBandwidthExpansion] = useState(0.994); 
  
  // EQ & Breath
  const [eqLowGain, setEqLowGain] = useState(5.0); 
  const [eqHighGain, setEqHighGain] = useState(3.0); // Boost highs for clarity
  const [breathMix, setBreathMix] = useState(0.12); // Reduced breathiness for less noise

  const [outputVolume, setOutputVolume] = useState(3.5);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [originalBuffer, setOriginalBuffer] = useState<AudioBuffer | null>(null);
  const [processedBuffer, setProcessedBuffer] = useState<AudioBuffer | null>(null);
  
  const [recording, setRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlayingResult, setIsPlayingResult] = useState(false); 
  const [message, setMessage] = useState("LPC Advanced (Organic Voice)");

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
      a.download = 'voice_changer_organic.wav';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  // --- CORE PROCESSING STEP 14 ---
  const processAudio = async () => {
    if (!audioContext || !originalBuffer) return;
    await resumeContext();

    setIsProcessing(true);
    setMessage("Processing - Organic Conversion...");
    await new Promise(r => setTimeout(r, 50));

    const sampleRate = audioContext.sampleRate;
    
    // Pre-emphasis
    const rawInput = originalBuffer.getChannelData(0);
    const inputData = new Float32Array(rawInput.length);
    inputData[0] = rawInput[0];
    for(let i=1; i<rawInput.length; i++) {
        inputData[i] = rawInput[i] - 0.95 * rawInput[i-1];
    }
    
    // Params
    const frameSize = 1024; 
    const hopSize = 256; 
    const order = lpcOrder;
    const gamma = bandwidthExpansion; 
    
    // Windowing (Hanning is better for overlap-add stability)
    const window = new Float32Array(frameSize);
    for(let i=0; i<frameSize; i++) window[i] = 0.5 - 0.5 * Math.cos(2*Math.PI*i/(frameSize-1));

    const tempBufferLen = Math.floor(inputData.length * 2.0); 
    const outputData = new Float32Array(tempBufferLen);
    
    // State
    let filterState = new Float32Array(order).fill(0);
    // Breath Filter: BandPass-like (HighPass + LowPass) for "Airy" sound, not "Hissy" static
    const breathHighPass = new BiquadFilter(1, 4000, sampleRate, 0.7, 0); // Higher cutoff for minimal mid-noise
    const breathLowPass = new BiquadFilter(0, 9000, sampleRate, 0.5, 0);  // Open up top end
    
    // Filter State for Pulse Shaping - Higher cutoff for less muffled sound
    const pulseLowPass = new BiquadFilter(0, 6000, sampleRate, 0.7, 0); 

    let phase = 0;
    const excitationPitchRatio = pitchShiftRatio / formantShiftRatio;
    
    let pitchHistory = new Array(5).fill(150);
    let lastStablePitch = 150;
    let outPtr = 0;

    let smoothedGain = 0; 
    let smoothedVoicing = 0;
    let voicingHoldCounter = 0;
    
    // Previous frame coefficients for interpolation
    let prevA = new Float32Array(order + 1).fill(0); prevA[0] = 1.0;

    const baseVoicingThreshold = 0.6 - (voicingSensitivity * 0.5); 
    const silenceThreshold = 0.0; // Gate disabled to prevent dropouts

    for (let i = 0; i < inputData.length - frameSize; i += hopSize) {
      const frame = new Float32Array(frameSize);
      for(let j=0; j<frameSize; j++) frame[j] = inputData[i+j] * window[j];

      const energy = calculateEnergy(frame);
      
      // Early exit/silence gate REMOVED to prevent dropouts
      

      // Analysis
      const aRaw = computeLPCAndRef(frame, order); 

      // Bandwidth Expansion
      const a = new Float32Array(order + 1);
      for(let k=0; k<=order; k++) {
          a[k] = aRaw[k] * Math.pow(gamma, k);
      }
      
      const { pitch, periodicity } = estimatePitchRobust(frame, sampleRate);
      const zcr = calculateZCR(frame);
      
      // Fixed Voicing Logic
      let currentVoicing = 0;
      if (periodicity > baseVoicingThreshold && energy > 0.0000001 && zcr < 0.35) {
          currentVoicing = 1.0;
          voicingHoldCounter = 15; // Hold longer for stability
      } else if (voicingHoldCounter > 0) {
          currentVoicing = 0.95; 
          voicingHoldCounter--;
      } else {
          currentVoicing = 0.0;
      }

      smoothedVoicing = smoothedVoicing * 0.9 + currentVoicing * 0.1; // Very smooth transition

      // Pitch Tracking - Strict stability
      let targetPitch = lastStablePitch;
      if (currentVoicing > 0 || voicingHoldCounter > 0) { 
          if(pitch > 60 && pitch < 600) {
            pitchHistory.shift(); pitchHistory.push(pitch);
            const sortedPitch = [...pitchHistory].sort((a,b)=>a-b);
            const medianPitch = sortedPitch[2]; // Median of 5
            
            // Limit pitch jumps (Octave error protection)
            const ratio = medianPitch / lastStablePitch;
            
            // Stricter ratio check to prevent "blips"
            if (ratio > 0.8 && ratio < 1.25) {
                targetPitch = lastStablePitch * 0.82 + medianPitch * 0.18;
            } else if (Math.abs(lastStablePitch - 150) < 1.0) {
                 targetPitch = medianPitch;
            } else {
                 // Ignore outlier pitch entirely
                 targetPitch = lastStablePitch;
            }
          }
          lastStablePitch = targetPitch;
      }

      // Synthesis Setup
      const f0 = lastStablePitch * excitationPitchRatio; 
      const periodSamples = sampleRate / f0;
      
      let targetGain = Math.sqrt(energy);
      if (smoothedVoicing > 0.5) targetGain *= pulseGainBoost; 
      
      // Generate Excitation loop
      for(let j=0; j<hopSize; j++) {
          // Interpolate coefficients
          const t = j / hopSize;
          const currentA = new Float32Array(order + 1);
          for(let k=0; k<=order; k++) currentA[k] = prevA[k] * (1-t) + a[k] * t;

          // Gain interpolation - slower attack to prevent clicks
          smoothedGain = smoothedGain * 0.95 + targetGain * 0.05;

          phase += 1.0 / periodSamples;
          // Reduced Jitter to prevent roughness
          phase += (Math.random() - 0.5) * 0.005; 
          if (phase >= 1.0) phase -= 1.0;

          // Pulse Generation - Mixed Waveforms (Balance between Body and Clarity)
          
          // 1. Soft Pulse (Cos^2) - Main Fundamental
          let sinePulse = 0;
          if (phase < 0.60) {
             const x = phase / 0.60;
             sinePulse = Math.pow(Math.sin(Math.PI * x), 2.0); 
          }
          
          // 2. Soft Sawtooth (Brighter version)
          // 0.5 to -0.5 and scaled
          let sawPulse = (0.5 - phase) * 2.0; 
          // Smoother Polynomial to reduce "bad quality" raspiness
          // Power 4 is a sweet spot between sharp(10) and muffled(2)
          sawPulse = sawPulse * (1.0 - Math.pow(Math.abs(2.0 * phase - 1.0), 4.0));

          // Mix: 80% Soft Pulse, 20% Saw (More texture than before)
          let pulse = sinePulse * 0.80 + sawPulse * 0.20;
          
          pulse = pulseLowPass.process(pulse);

          // Pink Noise Approximation for smoother breath (Simple 1/f filter)
          let white = (Math.random() - 0.5) * 2.0;
          let noise = breathHighPass.process(white);
          noise = breathLowPass.process(noise);
          
          // Mix
          const voiced = pulse;
          const unvoiced = noise * 0.35; // Reduced noise base (was 0.6)
          
          // Natural Mix
          let excitationSample = voiced * smoothedVoicing + unvoiced * (1.0 - smoothedVoicing) * 0.4;
          
          // Add Breathiness (Constant but filtered layer)
          if(smoothedVoicing > 0.5) {
              excitationSample += noise * breathMix; 
          }

          excitationSample *= smoothedGain;

          // LPC Synthesis Filter
          let predicted = 0;
          for(let k=1; k<=order; k++) predicted -= currentA[k] * filterState[k-1];
          
          let outSample = excitationSample + predicted;
          
          // HARD CLIP LIMITER to stop "blips"
          if (outSample > 4.0) outSample = 4.0;
          if (outSample < -4.0) outSample = -4.0;
          
          // Stability Check
          if (!isFinite(outSample)) {
             outSample = 0;
             for(let k=0; k<order; k++) filterState[k] = 0; 
          } else {
             for (let k = order - 1; k > 0; k--) filterState[k] = filterState[k - 1];
             filterState[0] = outSample;
          }
          
          if (outPtr < outputData.length) {
              outputData[outPtr++] = outSample;
          }
      }
      
      // Save for next frame
      prevA.set(a);
    }

    // Post Processing
    const validLen = outPtr;
    const targetLen = Math.floor(validLen / formantShiftRatio);
    let finalData = resample(outputData.slice(0, validLen), targetLen > 0 ? targetLen : 1);

    // EQ (Warmer settings)
    const eqLow = new BiquadFilter(3, 180, sampleRate, 0.7, eqLowGain);
    const eqHigh = new BiquadFilter(4, 4500, sampleRate, 0.7, eqHighGain); 
    const eqMid = new BiquadFilter(6, 1200, sampleRate, 1.0, -3); // Cut mids for less "boxiness"

    for(let i=0; i<finalData.length; i++) {
        let s = finalData[i];
        s = eqLow.process(s);
        s = eqHigh.process(s);
        s = eqMid.process(s);
        
        // Intelligent Volume Gain with Soft Clipping
        // 1. Apply user volume (Boosted base gain)
        // Previous Tanh compressed too early. We boost signal MORE before tanh
        // to push "loudness" up against the ceiling.
        s *= (outputVolume * 1.5); 

        // 2. Soft Clip (Tanh)
        // Tanh is nice but can be quiet if input isn't hot enough.
        s = Math.tanh(s); 
        
        // 3. Make up gain? No, tanh(x) is max 1.
        // But if s was huge, tanh(s) is 1. That's fine.

        // 4. Final safety clip
        if (s > 0.99) s = 0.99;
        if (s < -0.99) s = -0.99;
        
        finalData[i] = s;
    }

    const outBuf = audioContext.createBuffer(1, finalData.length, sampleRate);
    outBuf.getChannelData(0).set(finalData);
    
    setProcessedBuffer(outBuf);
    setIsProcessing(false);
    setMessage("Conversion Complete (Organic Voice).");
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
        <h1 className="text-2xl font-bold flex items-center gap-2 text-indigo-600">
          <User className="w-6 h-6 text-green-500" />
          Organic Voice (Soft Resonance) (v2)
        </h1>
        <p className="text-gray-600 mt-2 text-sm">
          Reduces resonance sharpness (bandwidth expansion) and pitch-syncs breath noise to eliminate buzzer-like artifacts and create a human-like texture.
        </p>
      </header>

      {/* 1. Input */}
      <div className="bg-white p-5 rounded-xl shadow-sm mb-6">
         <h2 className="font-bold text-lg mb-3 flex items-center gap-2"><Mic className="w-4 h-4"/> Input Source</h2>
         <div className="flex flex-wrap gap-3 mb-4">
            {!recording ? (
                <button onClick={startRecordingFixed} className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-full flex items-center gap-2 shadow transition">
                  <Mic className="w-4 h-4" /> Record
                </button>
            ) : (
                <button onClick={stopRecording} className="bg-gray-800 hover:bg-gray-900 text-white px-6 py-2 rounded-full flex items-center gap-2 animate-pulse shadow transition">
                  <StopCircle className="w-4 h-4" /> Stop
                </button>
            )}
            <span className="text-gray-300 self-center">|</span>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-gray-50 text-sm">
                <FileAudio className="w-4 h-4" /> File
            </button>
            <div className="flex flex-wrap gap-2 items-center ml-2 pl-2 border-l border-gray-200">
                <span className="text-xs text-gray-400 font-bold">SAMPLES:</span>
                {SAMPLES.map((sample) => (
                    <button 
                        key={sample.file} 
                        onClick={() => loadSampleAudio(sample.file)} 
                        className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs px-2 py-1.5 rounded border border-indigo-200 transition"
                    >
                        {sample.name}
                    </button>
                ))}
            </div>
            {originalBuffer && (
                <button onClick={() => playAudio(originalBuffer)} className="text-indigo-600 font-bold text-sm flex items-center gap-1 hover:underline">
                    <Volume2 className="w-4 h-4"/> Play Org
                </button>
            )}
         </div>
         <div className="bg-gray-900 rounded h-20 w-full relative">
            <canvas ref={canvasRef} width={600} height={80} className="w-full h-full" />
         </div>
      </div>

      {/* 2. Controls */}
      <div className="bg-white p-5 rounded-xl shadow-sm mb-6">
        <h2 className="font-bold text-lg mb-3 flex items-center gap-2"><Sliders className="w-4 h-4"/> Parameters</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4 border-r md:pr-4 border-gray-200">
                <h3 className="text-sm font-bold text-gray-500">Quality & Texture (New)</h3>
                <div>
                    <label className="flex justify-between text-sm font-semibold mb-1 text-green-600">
                        <span>Softness (Resonance)</span>
                        <span>{bandwidthExpansion.toFixed(3)}</span>
                    </label>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">Sharp</span>
                        <input type="range" min="0.950" max="0.995" step="0.001" value={bandwidthExpansion} onChange={e => setBandwidthExpansion(Number(e.target.value))} className="w-full accent-green-500"/>
                        <span className="text-xs text-gray-400">Soft</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Lower values reduce metallic sound, creating a softer tone.</p>
                </div>
                <div>
                    <label className="flex justify-between text-sm font-semibold mb-1 text-red-600">
                        <span>Pulse Strength</span>
                        <span>x{pulseGainBoost.toFixed(2)}</span>
                    </label>
                    <input type="range" min="1.0" max="2.0" step="0.05" value={pulseGainBoost} onChange={e => setPulseGainBoost(Number(e.target.value))} className="w-full accent-red-500"/>
                </div>
                <div>
                    <label className="flex justify-between text-sm font-semibold mb-1 text-gray-900">
                        <span>Output Volume</span>
                        <span>x{outputVolume.toFixed(2)}</span>
                    </label>
                    <input type="range" min="1.0" max="5.0" step="0.1" value={outputVolume} onChange={e => setOutputVolume(Number(e.target.value))} className="w-full accent-black"/>
                </div>
            </div>
            
            <div className="space-y-4">
                <h3 className="text-sm font-bold text-gray-500">Basic Settings</h3>
                <div>
                    <label className="flex justify-between text-sm font-semibold mb-1 text-purple-700">
                        <span>Pitch (x1.45)</span>
                        <span>x{pitchShiftRatio.toFixed(2)}</span>
                    </label>
                    <input type="range" min="0.5" max="2.0" step="0.05" value={pitchShiftRatio} onChange={e => setPitchShiftRatio(Number(e.target.value))} className="w-full accent-purple-600"/>
                </div>
                <div>
                    <label className="flex justify-between text-sm font-semibold mb-1 text-green-700">
                        <span>Formant (x1.15)</span>
                        <span>x{formantShiftRatio.toFixed(2)}</span>
                    </label>
                    <input type="range" min="0.8" max="1.5" step="0.05" value={formantShiftRatio} onChange={e => setFormantShiftRatio(Number(e.target.value))} className="w-full accent-green-600"/>
                </div>
                <div>
                    <label className="flex justify-between text-sm font-semibold mb-1 text-teal-700">
                        <span>LPC Order</span>
                        <span>{lpcOrder}</span>
                    </label>
                    <input type="range" min="16" max="64" step="4" value={lpcOrder} onChange={e => setLpcOrder(Number(e.target.value))} className="w-full accent-teal-600"/>
                </div>
                <div>
                    <label className="flex justify-between text-sm font-semibold mb-1 text-gray-700">
                        <span>Breath Mix</span>
                        <span>{(breathMix * 100).toFixed(0)}%</span>
                    </label>
                    <input type="range" min="0" max="0.3" step="0.01" value={breathMix} onChange={e => setBreathMix(Number(e.target.value))} className="w-full accent-gray-500"/>
                </div>
            </div>
        </div>

        <button 
            onClick={processAudio} 
            disabled={!originalBuffer || isProcessing}
            className={`mt-6 w-full py-3 rounded-lg font-bold text-white flex justify-center items-center gap-2 transition ${!originalBuffer ? 'bg-gray-300' : 'bg-gradient-to-r from-green-500 to-teal-500 hover:scale-[1.02] shadow-lg'}`}
        >
            {isProcessing ? <Loader2 className="animate-spin" /> : <Zap />}
            Convert (Soft Resonance)
        </button>
        <p className="text-center text-xs text-gray-400 mt-2">{message}</p>
      </div>

      {/* 3. Output */}
      <div className="bg-white p-5 rounded-xl shadow-sm border-t-4 border-indigo-500">
         <h2 className="font-bold text-lg mb-3 flex items-center gap-2"><Volume2 className="w-4 h-4"/> Final Result</h2>
         
         <div className="flex justify-center gap-4">
            {processedBuffer ? (
                <>
                {isPlayingResult ? (
                    <button onClick={stopAudio} className="bg-red-500 hover:bg-red-600 text-white px-8 py-3 rounded-full font-bold shadow-lg flex items-center gap-2">
                        <Square className="fill-current w-4 h-4" /> Stop
                    </button>
                ) : (
                    <button onClick={() => playAudio(processedBuffer)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-full font-bold shadow-lg flex items-center gap-2 transform hover:scale-105 transition">
                        <Play className="fill-current" /> Play Result
                    </button>
                )}
                
                <button onClick={downloadAudio} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-full font-bold shadow-lg flex items-center gap-2">
                     <Download className="w-4 h-4" /> Save
                </button>

                </>
            ) : (
                <div className="text-gray-400 text-sm bg-gray-100 px-4 py-2 rounded">Waiting for conversion...</div>
            )}
         </div>


      </div>

    </div>
  );
};

export default VoiceChangerStep14;