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
  Info,
  Copy,
  Check,
  History as HistoryIcon,
  Search,
  Trash2,
  ChevronLeft,
  Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';

const SYSTEM_PROMPT = `You are "Senior Dev Helper," an expert full-stack engineer and debugger. 
Your goal: Help self-taught developers fix errors without making them feel stupid.

STRATEGY BY ERROR TYPE:
- FRONTEND (React/Vite): Look for "Hook" violations, missing imports, or "ReferenceError". Check if they forgot to install a library.
- BACKEND (Node/Express): Check for "EADDRINUSE" (port busy), middleware order, or unhandled promise rejections. 
- DEPENDENCIES: If you see "module not found" or "peer dependency" errors, suggest clearing node_modules/package-lock and re-installing.
- LOGIC/SYNTAX: Look for missing brackets, typos in variable names, or scope issues.

OUTPUT FORMAT:
1. IDENTIFY: Briefly state what the error is and where it usually comes from.
2. PLAIN ENGLISH EXPLANATION: Use a simple analogy (e.g., "It's like trying to call a phone number that hasn't been assigned yet").
3. STEP-BY-STEP FIX: 
   - 1. ... 
   - 2. ...
4. COPY-PASTE CODE: Provide the corrected code block with comments.
5. PRO-TIP: One sentence on how to avoid this next time (e.g., "Enable Auto-save" or "Use a Linter").

TONE: Encouraging, authoritative but friendly. Use 1-2 developer emojis. No corporate speak.`;

enum AISource {
  OLLAMA = 'Ollama (Local)',
  GEMINI = 'Gemini (Cloud Fallback)',
  NONE = 'None'
}

interface HistoryItem {
  id: string;
  timestamp: number;
  inputText: string;
  solution: string;
  source: AISource;
  imagePreview?: string | null;
}

export default function App() {
  const [inputText, setInputText] = useState('');
  const [solution, setSolution] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [source, setSource] = useState<AISource>(AISource.NONE);
  const [error, setError] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<{ base64: string, mimeType: string } | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isConcise, setIsConcise] = useState(false);
  
  // History State
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [searchHistory, setSearchHistory] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const solutionEndRef = useRef<HTMLDivElement>(null);

  // Load history on mount
  useEffect(() => {
    const saved = localStorage.getItem('senior_dev_history');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }
  }, []);

  // Save history on change
  useEffect(() => {
    localStorage.setItem('senior_dev_history', JSON.stringify(history));
  }, [history]);

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

  const copySolution = async () => {
    if (!solution) return;
    try {
      await navigator.clipboard.writeText(solution);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy technical solution:', err);
    }
  };

  const addToHistory = (text: string, sol: string, src: AISource, preview: string | null) => {
    const newItem: HistoryItem = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      inputText: text || (preview ? "[Screenshot provided]" : "Untitled Error"),
      solution: sol,
      source: src,
      imagePreview: preview
    };
    setHistory(prev => [newItem, ...prev].slice(0, 50)); // Keep last 50
  };

  const loadFromHistory = (item: HistoryItem) => {
    setInputText(item.inputText === "[Screenshot provided]" ? "" : item.inputText);
    setSolution(item.solution);
    setSource(item.source);
    setImagePreview(item.imagePreview || null);
    setScreenshot(null); // Clear active screenshot if loading history
    setIsHistoryOpen(false);
  };

  const deleteHistoryItem = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setHistory(prev => prev.filter(i => i.id !== id));
  };

  const clearAllHistory = () => {
    if (confirm("Clear all past sessions?")) {
      setHistory([]);
    }
  };

  const callOllama = async (prompt: string, img?: { base64: string, mimeType: string }) => {
    const ollamaHost = (import.meta as any).env.VITE_OLLAMA_HOST || 'http://localhost:11434';
    const conciseInstruction = isConcise 
      ? "\n\nSTRICT BREVITY MODE: Skip analogies and long explanations. Just Identify, Fix Steps, and Code. Be extremely direct." 
      : "";

    try {
      const response = await fetch(`${ollamaHost}/api/generate`, {
        method: 'POST',
        body: JSON.stringify({
          model: "gemma4:e2b",
          prompt: `${SYSTEM_PROMPT}${conciseInstruction}\n\nUser Input: ${prompt}`,
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
    const conciseInstruction = isConcise 
      ? "\n\nSTRICT BREVITY MODE: Skip analogies and long explanations. Just Identify, Fix Steps, and Code. Be extremely direct." 
      : "";
    
    const parts: any[] = [{ text: `${SYSTEM_PROMPT}${conciseInstruction}\n\nUser Input: ${prompt}` }];
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
      let result = await callOllama(inputText, screenshot || undefined);
      let activeSource = AISource.OLLAMA;
      
      if (!result) {
        result = await callGemini(inputText, screenshot || undefined);
        activeSource = AISource.GEMINI;
      }

      if (result) {
        setSolution(result);
        setSource(activeSource);
        addToHistory(inputText, result, activeSource, imagePreview);
      } else {
        throw new Error('All AI providers failed.');
      }
    } catch (err: any) {
      setError('Diagnosis failed. Are you connected to the internet? If using Ollama, is it running?');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredHistory = history.filter(item => 
    item.inputText.toLowerCase().includes(searchHistory.toLowerCase()) || 
    item.solution.toLowerCase().includes(searchHistory.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-terminal-bg text-terminal-text p-4 md:p-8 flex flex-col items-center">
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-4xl"
      >
        {/* Header */}
        <header className="flex items-center justify-between mb-8 border-b border-terminal-border pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-terminal-accent/10 rounded-lg">
              <Terminal className="w-8 h-8 text-terminal-accent" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">$ senior-dev --help</h1>
              <p className="text-sm opacity-60">Bridging the gap between "stuck" and "solved".</p>
            </div>
          </div>
          
          <button 
            onClick={() => setIsHistoryOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-terminal-border hover:bg-terminal-panel transition-colors text-xs font-mono"
          >
            <HistoryIcon className="w-4 h-4" />
            HISTORY ({history.length})
          </button>
        </header>

        {/* History Drawer Overlay */}
        <AnimatePresence>
          {isHistoryOpen && (
            <>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsHistoryOpen(false)}
                className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                className="fixed top-0 right-0 h-full w-full max-w-sm bg-terminal-panel border-l border-terminal-border z-50 shadow-2xl flex flex-col"
              >
                <div className="p-4 border-b border-terminal-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HistoryIcon className="w-5 h-5 text-terminal-accent" />
                    <h2 className="font-bold text-white uppercase tracking-tighter">Past Sessions</h2>
                  </div>
                  <button onClick={() => setIsHistoryOpen(false)} className="p-1 hover:bg-terminal-border/20 rounded">
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-4 border-b border-terminal-border">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-30" />
                    <input 
                      type="text"
                      placeholder="Filter history..."
                      className="w-full bg-terminal-bg rounded-md border border-terminal-border py-2 pl-9 pr-4 text-xs font-mono focus:outline-none focus:border-terminal-accent"
                      value={searchHistory}
                      onChange={(e) => setSearchHistory(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {filteredHistory.length === 0 ? (
                    <div className="text-center py-12 opacity-30 text-xs">
                      No matching sessions found.
                    </div>
                  ) : (
                    filteredHistory.map(item => (
                      <div 
                        key={item.id}
                        onClick={() => loadFromHistory(item)}
                        className="p-3 bg-terminal-bg border border-terminal-border rounded-lg hover:border-terminal-accent/40 cursor-pointer transition-all group"
                      >
                        <div className="flex justify-between items-start gap-2 mb-2">
                          <div className="flex items-center gap-2 text-[10px] opacity-40 font-mono">
                            <Clock className="w-3 h-3" />
                            {new Date(item.timestamp).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}
                          </div>
                          <button 
                            onClick={(e) => deleteHistoryItem(e, item.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:text-terminal-error transition-all"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        <p className="text-xs line-clamp-2 opacity-80 leading-relaxed">
                          {item.inputText}
                        </p>
                      </div>
                    ))
                  )}
                </div>

                {history.length > 0 && (
                  <div className="p-4 border-t border-terminal-border">
                    <button 
                      onClick={clearAllHistory}
                      className="w-full py-2 text-[10px] font-bold text-terminal-error/60 hover:text-terminal-error hover:bg-terminal-error/5 border border-terminal-error/20 rounded transition-all flex items-center justify-center gap-2"
                    >
                      <Trash2 className="w-3 h-3" />
                      WIPE ENTIRE HISTORY
                    </button>
                  </div>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>

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
                  onClick={() => setIsConcise(!isConcise)}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg border transition-all ${
                    isConcise 
                      ? 'border-terminal-warning bg-terminal-warning/10 text-terminal-warning' 
                      : 'border-terminal-border hover:border-terminal-accent'
                  }`}
                >
                  <Info className="w-4 h-4" />
                  {isConcise ? 'Concise Mode: ON' : 'Concise Mode: OFF'}
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
                    <div className="flex items-center gap-3">
                      <button
                        onClick={copySolution}
                        className="flex items-center gap-1.5 px-2 py-1 rounded border border-terminal-border bg-terminal-bg hover:bg-terminal-border/20 transition-colors group"
                        title="Copy solution markdown"
                      >
                        {isCopied ? (
                          <Check className="w-3 h-3 text-terminal-success" />
                        ) : (
                          <Copy className="w-3 h-3 text-terminal-accent group-hover:scale-110 transition-transform" />
                        )}
                        <span className="text-[10px] font-mono opacity-70">
                          {isCopied ? 'COPIED' : 'COPY'}
                        </span>
                      </button>
                      <span className="text-[10px] font-mono opacity-50 px-2 py-1 rounded border border-terminal-border bg-terminal-bg">
                        Source: {source}
                      </span>
                    </div>
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
