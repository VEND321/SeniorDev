/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { 
  Terminal, 
  Upload, 
  AlertCircle, 
  CheckCircle2, 
  Loader2, 
  ArrowRight, 
  Save, 
  X,
  Bug,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';

const SYSTEM_PROMPT = `You are "Senior Dev Helper," an expert full-stack engineer and debugger. 
Your goal: Help self-taught developers fix errors without making them feel stupid.

RULES:
1. ANALYZE: First, identify the error. If a screenshot is provided, perform OCR and look for the red text or stack trace.
2. EXPLAIN: Explain the cause in plain English (e.g., "This means the computer is looking for a file that isn't where you said it would be").
3. FIX: Provide a step-by-step numbered list of instructions.
4. CODE: Provide the exact code to copy-paste.
5. PREVENTION: Briefly mention one tip to avoid this error in the future.
6. TONE: Professional, patient, and use 1-2 developer emojis. No corporate fluff.
7. LANGUAGE: Plain English, strictly. No overly academic jargon.`;

enum AISource {
  OLLAMA = 'Ollama (Local)',
  GEMINI = 'Gemini (Cloud Fallback)',
  NONE = 'None'
}

export default function App() {
  const [inputText, setInputText] = useState('');
  const [solution, setSolution] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [source, setSource] = useState<AISource>(AISource.NONE);
  const [error, setError] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<{ base64: string, mimeType: string } | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const solutionEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (solutionEndRef.current) {
      solutionEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [solution]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (screenshot).');
      return;
    }

    const formData = new FormData();
    formData.append('screenshot', file);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (data.base64) {
        setScreenshot({ base64: data.base64, mimeType: data.mimeType });
        setImagePreview(URL.createObjectURL(file));
        setError(null);
      }
    } catch (err) {
      setError('Failed to process image upload.');
    }
  };

  const clearScreenshot = () => {
    setScreenshot(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const callOllama = async (prompt: string, img?: { base64: string, mimeType: string }) => {
    const ollamaHost = (import.meta as any).env.VITE_OLLAMA_HOST || 'http://localhost:11434';
    try {
      const response = await fetch(`${ollamaHost}/api/generate`, {
        method: 'POST',
        body: JSON.stringify({
          model: "gemma4:e2b",
          prompt: `${SYSTEM_PROMPT}\n\nUser Input: ${prompt}`,
          images: img ? [img.base64] : [],
          stream: false
        }),
      });
      if (!response.ok) throw new Error('Ollama not reachable');
      const data = await response.json();
      return data.response;
    } catch (e) {
      console.warn("Ollama fallback triggered:", e);
      return null;
    }
  };

  const callGemini = async (prompt: string, img?: { base64: string, mimeType: string }) => {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    const parts: any[] = [{ text: `${SYSTEM_PROMPT}\n\nUser Input: ${prompt}` }];
    if (img) {
      parts.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.base64
        }
      });
    }

    const response: GenerateContentResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts },
    });

    return response.text;
  };

  const handleFix = async () => {
    if (!inputText && !screenshot) {
      setError('Please provide an error message or a screenshot.');
      return;
    }

    setIsLoading(true);
    setSolution('');
    setError(null);
    setSource(AISource.NONE);

    try {
      // Step 1: Try Ollama
      let result = await callOllama(inputText, screenshot || undefined);
      
      if (result) {
        setSolution(result);
        setSource(AISource.OLLAMA);
      } else {
        // Step 2: Fallback to Gemini
        result = await callGemini(inputText, screenshot || undefined);
        if (result) {
          setSolution(result);
          setSource(AISource.GEMINI);
        } else {
          throw new Error('All AI providers failed.');
        }
      }
    } catch (err: any) {
      setError('Diagnosis failed. Are you connected to the internet? If using Ollama, is it running?');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-terminal-bg text-terminal-text p-4 md:p-8 flex flex-col items-center">
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-4xl"
      >
        {/* Header */}
        <header className="flex items-center gap-3 mb-8 border-b border-terminal-border pb-4">
          <div className="p-2 bg-terminal-accent/10 rounded-lg">
            <Terminal className="w-8 h-8 text-terminal-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">$ senior-dev --help</h1>
            <p className="text-sm opacity-60">Bridging the gap between "stuck" and "solved".</p>
          </div>
        </header>

        {/* Input Terminal Panel */}
        <div className="grid grid-cols-1 gap-6">
          <div className="bg-terminal-panel border border-terminal-border rounded-xl overflow-hidden terminal-glow">
            <div className="bg-terminal-border/30 px-4 py-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-widest opacity-70">Error Input</span>
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-terminal-error/50" />
                <div className="w-2.5 h-2.5 rounded-full bg-terminal-warning/50" />
                <div className="w-2.5 h-2.5 rounded-full bg-terminal-success/50" />
              </div>
            </div>
            
            <div className="p-4 space-y-4">
              <div className="relative">
                <textarea
                  className="w-full h-48 bg-terminal-bg rounded-lg border border-terminal-border p-4 text-sm font-mono focus:outline-none focus:border-terminal-accent transition-colors resize-none placeholder:opacity-30"
                  placeholder="Paste your error message or explain what went wrong..."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                />
                <Bug className="absolute top-4 right-4 w-5 h-5 opacity-10" />
              </div>

              {/* Upload & Actions */}
              <div className="flex flex-wrap items-center gap-4">
                <input 
                  type="file" 
                  className="hidden" 
                  ref={fileInputRef}
                  accept="image/*"
                  onChange={handleFileUpload}
                />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg border border-dashed border-terminal-border hover:border-terminal-accent hover:bg-terminal-accent/5 transition-all group"
                >
                  <Upload className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform" />
                  {screenshot ? 'Update Screenshot' : 'Upload Screenshot'}
                </button>

                <button 
                  onClick={handleFix}
                  disabled={isLoading}
                  className="ml-auto flex items-center gap-2 px-6 py-2.5 bg-terminal-accent text-white font-bold rounded-lg hover:brightness-110 active:scale-95 transition-all disabled:opacity-50 disabled:active:scale-100"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      ANALYZING...
                    </>
                  ) : (
                    <>
                      <ArrowRight className="w-4 h-4" />
                      DIAGNOSE & FIX
                    </>
                  )}
                </button>
              </div>

              {/* Screenshot Preview */}
              <AnimatePresence>
                {imagePreview && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="relative bg-terminal-bg rounded-lg p-2 border border-terminal-border"
                  >
                    <button 
                      onClick={clearScreenshot}
                      className="absolute top-4 right-4 p-1 bg-terminal-error rounded-full text-white hover:scale-110 transition-transform z-10"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <img src={imagePreview} alt="Screenshot preview" className="max-h-64 rounded mx-auto" />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Error Message */}
              {error && (
                <div className="flex items-center gap-2 text-terminal-error text-xs p-3 bg-terminal-error/10 rounded-lg border border-terminal-error/20">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}
            </div>
          </div>

          {/* Solution Area */}
          <AnimatePresence>
            {(solution || isLoading) && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-terminal-panel border border-terminal-border rounded-xl overflow-hidden terminal-glow mb-20"
              >
                <div className="bg-terminal-accent/10 px-4 py-2 flex items-center justify-between border-b border-terminal-accent/20">
                  <div className="flex items-center gap-2">
                    {isLoading ? (
                      <Loader2 className="w-4 h-4 text-terminal-accent animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-terminal-success" />
                    )}
                    <span className="text-xs font-semibold uppercase tracking-widest text-terminal-accent">
                      {isLoading ? 'System Analysis in progress...' : 'Solution Generated'}
                    </span>
                  </div>
                  {!isLoading && (
                    <span className="text-[10px] font-mono opacity-50 px-2 py-0.5 rounded border border-terminal-border bg-terminal-bg">
                      Source: {source}
                    </span>
                  )}
                </div>

                <div className="p-6 markdown-body">
                  {isLoading ? (
                    <div className="space-y-4 py-4">
                      <div className="h-4 bg-terminal-border/20 rounded w-3/4 animate-pulse" />
                      <div className="h-4 bg-terminal-border/20 rounded w-1/2 animate-pulse" />
                      <div className="h-24 bg-terminal-border/20 rounded w-full animate-pulse" />
                    </div>
                  ) : (
                    <Markdown>{solution}</Markdown>
                  )}
                  <div ref={solutionEndRef} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer info for empty state */}
        {!solution && !isLoading && (
          <div className="mt-12 text-center text-xs opacity-40 space-y-4">
            <div className="flex items-center justify-center gap-6">
              <div className="flex items-center gap-2">
                <Info className="w-3 h-3" />
                <span>Supports code snippets, stack traces, & terminal screens</span>
              </div>
              <div className="flex items-center gap-2">
                <Save className="w-3 h-3" />
                <span>Automatic local-first routing</span>
              </div>
            </div>
            <p className="max-w-md mx-auto">
              Note: To use local acceleration, ensure <strong>Ollama</strong> is running on your machine with <strong>gemma4:e2b</strong> installed.
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
