import { useState, useRef, useEffect } from "react";
import { ChatMessage } from "../types";
import { API_BASE } from "../lib/api";
import { motion, AnimatePresence } from "motion/react";
import { MessageSquare, Send, X, AlertOctagon, HelpCircle, HeartHandshake, Volume2, Sparkles, Loader2 } from "lucide-react";

interface AIChatbotProps {
  lang: 'en' | 'ur';
  onEmergencyTriggered: () => void;
}

export default function AIChatbot({ lang, onEmergencyTriggered }: AIChatbotProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome-ai",
      sender: "ai",
      text: lang === 'en' 
        ? "Assalam-o-Alaikum! I am your BloodRadar Assistant. You can ask me about donor compatibilities, nearby Islamabad/Rawalpindi hospital statuses, or triage active emergencies instantly." 
        : "السلام علیکم! میں بلڈ ریڈار AI اسسٹنٹ ہوں۔ آپ مجھ سے خون کے گروپوں کی مطابقت، راولپنڈی اور اسلام آباد کے قریبی ہسپتالوں کی صورتحال، یا ہنگامی حالات کے بارے میں پوچھ سکتے ہیں۔",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [speechActive, setSpeechActive] = useState(false);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Honest labeling: ask the backend whether a Gemini key is configured
  // instead of claiming an AI engine. Null until the check resolves.
  useEffect(() => {
    fetch(`${API_BASE}/api/chat/status`)
      .then(res => (res.ok ? res.json() : null))
      .then((data: { aiEnabled: boolean } | null) => {
        setAiEnabled(data ? data.aiEnabled : false);
      })
      .catch(() => setAiEnabled(false));
  }, []);

  // Keyboard a11y: move focus into the chat input when the panel opens and
  // let Escape close it (WCAG 2.1.2 / 2.4.3).
  useEffect(() => {
    if (!isOpen) return;
    document.getElementById("input-ai-chat-message")?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  // Suggested Quick replies
  const suggestions = lang === 'en' 
    ? [
        "Compatible donors for O-",
        "PIMS Islamabad blood info",
        "Saddar Rawalpindi camps",
        "Emergency SOS Help"
      ]
    : [
        "O منفی کے لیے موزوں عطیہ دہندگان",
        "پمز اسلام آباد میں خون کی صورتحال",
        "صدر راولپنڈی کے خون کیمپ",
        "فوری SOS مدد"
      ];

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  // Handle Speech synthesis (fallback to Web Speech API)
  const speakText = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    
    const cleanText = text.replace(/[#*`_]/g, ''); // strip markdown syntax
    const utterance = new SpeechSynthesisUtterance(cleanText);
    
    // Set speech voice parameters
    if (lang === 'ur') {
      utterance.lang = 'ur-PK';
    } else {
      utterance.lang = 'en-US';
    }
    utterance.rate = 1.0;

    utterance.onstart = () => setSpeechActive(true);
    utterance.onend = () => setSpeechActive(false);
    utterance.onerror = () => setSpeechActive(false);

    window.speechSynthesis.speak(utterance);
  };

  const handleSend = async (textToSend: string) => {
    if (!textToSend.trim()) return;

    const userMsg: ChatMessage = {
      id: "msg-" + Date.now() + "-usr",
      sender: "user",
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: textToSend,
          sessionId: "bloodradar_session_user",
          language: lang
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.reply) {
          setMessages(prev => [...prev, data.reply]);
          if (data.reply.isEmergencyAlert) {
            onEmergencyTriggered();
          }
        }
      } else {
        throw new Error("Chat response status not OK");
      }
    } catch (e) {
      console.error(e);
      // Fallback
      const isSOS = textToSend.toLowerCase().includes("urgent") || textToSend.toLowerCase().includes("emergency");
      const fallbackReply: ChatMessage = {
        id: "msg-" + Date.now() + "-fallback",
        sender: "ai",
        text: lang === 'en' 
          ? "I am blood helper AI. I recommend you access the SOS form or contact PIMS / Holy Family directly. Dial 1122 immediately for urgent issues."
          : "میں خونی معاون ہوں۔ ہم آپ کو ہیلپ لائن 1122 اور قریبی ہسپتالوں سے رابطہ کرنے کا مشورہ دیتے ہیں۔",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isEmergencyAlert: isSOS,
        source: "fallback"
      };
      setMessages(prev => [...prev, fallbackReply]);
      if (isSOS) {
        onEmergencyTriggered();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating Action Badge Button */}
      <div className="fixed bottom-6 right-6 z-50">
        <motion.button
          id="btn-toggle-ai-chat"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-label={lang === 'en' ? 'Toggle BloodRadar Assistant chat' : 'بلڈ ریڈار اسسٹنٹ چیٹ کھولیں/بند کریں'}
          className="flex items-center gap-2.5 px-4.5 py-3.5 rounded-full bg-[var(--blood)] hover:brightness-110 text-white font-medium shadow-xl shadow-rose-200 border border-rose-400"
        >
          <Sparkles className="w-5 h-5 animate-pulse" />
          <span className="text-sm tracking-wide font-sans font-semibold">
            {lang === 'en' ? 'BloodRadar Assistant' : 'بلڈ ریڈار کونسلر'}
          </span>
          <span className="flex h-2.5 w-2.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
        </motion.button>
      </div>

      {/* Entrance-only motion, no exit gating: exit animations stall in
          throttled/background tabs (paused rAF) and leave the panel stuck
          open — closing must be instant for reliability. */}
      {isOpen && (
          <motion.div
            id="ai-chatbot-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={lang === 'en' ? 'BloodRadar Medical Companion chat' : 'بلڈ ریڈار میڈیکل اسسٹنٹ چیٹ'}
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="fixed bottom-24 right-6 w-full max-w-sm md:max-w-md h-[550px] rounded-2.5xl bg-[var(--card)]/95 backdrop-blur-xl border border-[var(--border)] shadow-2xl z-50 flex flex-col overflow-hidden text-[var(--ink)]"
          >
            {/* Header */}
            <div className="p-4 bg-[var(--surface)] border-b border-slate-150 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-[var(--blood)] flex items-center justify-center text-white shadow shadow-rose-500/30">
                  <HeartHandshake className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[var(--ink)] font-sans tracking-wide">
                    BloodRadar Medical Companion
                  </h4>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${aiEnabled === false ? 'bg-amber-500' : 'bg-emerald-500'} animate-pulse`}></div>
                    <span className="text-[10px] text-[var(--muted)] uppercase tracking-widest font-mono">
                      {aiEnabled === null
                        ? 'Checking status...'
                        : aiEnabled
                          ? 'AI assistant · Gemini'
                          : 'Offline assistant · rules-based'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  id="btn-voice-chat-speak"
                  onClick={() => speakText(messages[messages.length - 1].text)}
                  disabled={speechActive}
                  aria-label={lang === 'en' ? 'Speak last answer' : 'آخری جواب سنائیں'}
                  className={`p-2 rounded-lg text-[var(--muted)] hover:bg-slate-100 hover:text-[var(--blood)] transition ${speechActive ? 'text-rose-550 scale-110' : ''}`}
                >
                  <Volume2 className="w-4 h-4 text-rose-500" aria-hidden="true" />
                </button>
                <button
                  id="btn-close-ai-chat"
                  onClick={() => setIsOpen(false)}
                  aria-label={lang === 'en' ? 'Close assistant' : 'اسسٹنٹ بند کریں'}
                  className="p-2 rounded-lg text-[var(--muted)] hover:bg-slate-100 hover:text-[var(--ink)] transition"
                >
                  <X className="w-4.5 h-4.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Warning Message Box */}
            <div className="px-4 py-2 bg-red-50 border-b border-red-100 flex items-center gap-2 text-red-700 text-xs">
              <AlertOctagon className="w-4 h-4 text-red-650 flex-shrink-0 animate-bounce" />
              <p className="leading-relaxed font-semibold">
                {lang === 'en' 
                  ? "AI guidance. In case of critical trauma, please call 1122 immediately!"
                  : "اے آئی تشخیصی معاونت۔ شدید ہنگامی صورتحال میں فوری طور پر 1122 کال کریں!"}
              </p>
            </div>

            {/* Chat Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 font-sans text-sm scrollbar-thin bg-[var(--surface)]/50">
              {messages.map((m) => (
                <div key={m.id} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl p-3.5 shadow-sm ${
                    m.sender === 'user' 
                      ? 'bg-[var(--blood)] text-white rounded-tr-none shadow shadow-rose-100' 
                      : m.isEmergencyAlert
                        ? 'bg-red-50 border border-red-200 text-red-950 rounded-tl-none font-semibold'
                        : 'bg-[var(--card)] border border-[var(--border)] text-slate-800 rounded-tl-none'
                  }`}>
                    {m.isEmergencyAlert && (
                      <div className="flex items-center gap-1 text-red-650 font-bold tracking-wide uppercase text-[10px] mb-1.5">
                        <AlertOctagon className="w-3.5 h-3.5" />
                        <span>High Urgent Triage Action Requested</span>
                      </div>
                    )}
                    {m.sender === 'ai' && m.source === 'fallback' && (
                      <div className="flex items-center gap-1 text-[var(--warn)] font-semibold uppercase tracking-wide text-[9px] mb-1.5">
                        <span>Rules-based answer · no AI connected</span>
                      </div>
                    )}
                    <span className="block whitespace-pre-wrap leading-relaxed">{m.text}</span>
                    <span className="block text-[10px] text-[var(--muted)] mt-1 text-right font-mono">
                      {m.timestamp}
                    </span>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-3.5 rounded-tl-none max-w-[85%] flex items-center gap-2.5 text-[var(--muted)]">
                    <Loader2 className="w-4.5 h-4.5 animate-spin text-rose-650" />
                    <span>Analyzing compatibility & hospitals...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick Suggestions Chips */}
            <div className="px-4 py-2 border-t border-[var(--border)] bg-[var(--card)]">
              <div className="flex flex-wrap gap-1.5 max-h-[70px] overflow-y-auto p-0.5">
                {suggestions.map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(s)}
                    className="px-2.5 py-1 rounded-full text-xs font-semibold border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-rose-500 hover:bg-slate-100 transition duration-200 cursor-pointer"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Message Input bar */}
            <div className="p-4 border-t border-[var(--border)] bg-[var(--card)] flex items-center gap-2">
              <input
                id="input-ai-chat-message"
                type="text"
                aria-label={lang === 'en' ? 'Ask the blood assistant' : 'معاون سے سوال پوچھیں'}
                placeholder={lang === 'en' ? "Query blood groups, PIMS status..." : "خون کی ضرورت کا پیغام لکھیں..."}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSend(input);
                }}
                className="flex-1 px-4 py-2.5 text-sm rounded-xl bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--blood)] focus:bg-[var(--card)] transition font-sans"
              />
              <button
                id="btn-send-ai-chat-message"
                onClick={() => handleSend(input)}
                disabled={loading || !input.trim()}
                aria-label={lang === 'en' ? 'Send message' : 'پیغام بھیجیں'}
                className="p-2.5 rounded-xl bg-[var(--blood)] hover:brightness-110 text-white transition disabled:opacity-40 cursor-pointer shrink-0"
              >
                <Send className="w-4.5 h-4.5" aria-hidden="true" />
              </button>
            </div>
          </motion.div>
        )}
    </>
  );
}
