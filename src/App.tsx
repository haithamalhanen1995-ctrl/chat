import React, { useState, useEffect } from 'react';
import { AuthView } from './components/AuthView';
import { ChatView } from './components/ChatView';
import { AdminPanel } from './components/AdminPanel';
import { Shield, MessageSquare, AlertCircle, Bell, Volume2, VolumeX, Globe } from 'lucide-react';
import { ChatGroup, ChatUser } from './types';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db, auth } from './firebase';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import { TRANSLATIONS, LanguageCode, LANGUAGES } from './lib/translations';

// Browser notification sound synthesizer using Web Audio API
const playNotificationSound = () => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    
    const playTone = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      
      gainNode.gain.setValueAtTime(0.15, start);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      osc.start(start);
      osc.stop(start + duration);
    };

    const now = ctx.currentTime;
    playTone(523.25, now, 0.15); // C5
    playTone(659.25, now + 0.1, 0.3); // E5
  } catch (err) {
    console.warn('Audio context play failed:', err);
  }
};

interface UserSession {
  id: string;
  role: 'admin' | 'user';
  fullName: string;
  username: string;
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null);
  const [isFirebaseReady, setIsFirebaseReady] = useState<boolean>(false);
  const [language, setLanguage] = useState<LanguageCode>(() => {
    const saved = localStorage.getItem('chat_platform_language');
    return (saved as LanguageCode) || 'AR';
  });
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [isAdminPathActive, setIsAdminPathActive] = useState<boolean>(false);
  const [adminViewToggle, setAdminViewToggle] = useState<'admin_panel' | 'chat_view'>('admin_panel');
  const [selectedGroupForChat, setSelectedGroupForChat] = useState<ChatGroup | null>(null);
  const [selectedContactForChat, setSelectedContactForChat] = useState<ChatUser | null>(null);
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);

  // Handle automatic Anonymous Firebase Authentication
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        console.log('Firebase auth session active:', user.uid, 'Anonymous:', user.isAnonymous);
        setIsFirebaseReady(true);
      } else {
        console.log('No active auth session, signing in anonymously...');
        try {
          await signInAnonymously(auth);
        } catch (err) {
          console.error('Error signing in anonymously:', err);
        }
      }
    });
    return () => unsub();
  }, []);

  // Auto-dismiss toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Global background listener for incoming notifications
  useEffect(() => {
    if (!currentUser) return;

    // Request Browser native notification permission
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().then((perm) => {
          console.log('Notification permission status:', perm);
        });
      }
    }

    const startTime = new Date();

    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', currentUser.id)
    );

    const unsub = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const notif = change.doc.data();
          
          // Check if it's a new notification created after the app loaded
          let isNew = false;
          if (notif.createdAt) {
            const createdAtDate = notif.createdAt.seconds 
              ? new Date(notif.createdAt.seconds * 1000) 
              : new Date(notif.createdAt);
            // Allow a small 5-second buffer for time drift
            if (createdAtDate.getTime() >= startTime.getTime() - 5000) {
              isNew = true;
            }
          }

          if (isNew) {
            // Play sound
            playNotificationSound();

            // Trigger System Native Notification (shows outside the browser/phone background)
            if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
              try {
                const sysNotif = new Notification(notif.title || 'رسالة جديدة 💬', {
                  body: notif.body || 'لديك إشعار جديد في المنصة',
                  icon: '/logo.png',
                  tag: change.doc.id,
                  renotify: true
                } as any);

                sysNotif.onclick = () => {
                  window.focus();
                };
              } catch (err) {
                console.warn('System Notification error:', err);
              }
            }

            // Trigger In-App beautiful Toast
            setToast({
              title: notif.title || 'إشعار جديد 💬',
              body: notif.body || 'لديك رسالة جديدة في المنصة'
            });
          }
        }
      });
    });

    return () => unsub();
  }, [currentUser?.id]);

  // Parse URL on load
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const invite = urlParams.get('invite');
    if (invite) {
      setInviteCode(invite);
      console.log('Detected invite code in URL:', invite);
    }

    // Check if the route specifies admin view
    const isAdmin = window.location.pathname.includes('/admin') || 
                    window.location.hash.includes('/admin') || 
                    urlParams.get('view') === 'admin';
    setIsAdminPathActive(isAdmin);
    console.log('Is Admin path active:', isAdmin);

    // Read session from localStorage
    const savedSession = localStorage.getItem('chat_platform_session');
    if (savedSession) {
      try {
        const user = JSON.parse(savedSession);
        setCurrentUser(user);
        console.log('Loaded active user session:', user.fullName);
      } catch (err) {
        console.error('Error loading session:', err);
        localStorage.removeItem('chat_platform_session');
      }
    }

    // Hash change listener
    const handleHashChange = () => {
      const isHashAdmin = window.location.hash.includes('/admin');
      if (isHashAdmin) {
        setIsAdminPathActive(true);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Handle successful login/registration
  const handleAuthSuccess = (user: UserSession) => {
    setCurrentUser(user);
    localStorage.setItem('chat_platform_session', JSON.stringify(user));
  };

  // Handle logout
  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('chat_platform_session');
    setAdminViewToggle('admin_panel');
    setSelectedGroupForChat(null);
    setSelectedContactForChat(null);
    // Clear URL parameters to be clean
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    url.searchParams.delete('view');
    window.history.replaceState({}, '', url.pathname);
  };

  const currentLangInfo = LANGUAGES.find((l) => l.code === language) || LANGUAGES[0];

  return (
    <div className="w-full min-h-screen bg-zinc-950 flex flex-col justify-between" dir={currentLangInfo.dir} id="app-root-container">
      
      {/* Top Banner indicating special paths / statuses */}
      {isAdminPathActive && !currentUser && (
        <div className="w-full bg-amber-500/10 border-b border-amber-500/20 text-amber-400 py-2 px-4 text-xs text-center font-sans flex items-center justify-center gap-2">
          <Shield size={14} />
          {language === 'AR' ? 'أنت الآن تتصفح مسار المالك المحمي (/admin). يرجى تسجيل الدخول بحساب المدير.' : 'You are browsing the protected Owner path (/admin). Please login with the Admin account.'}
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex items-center justify-center">
        {currentUser ? (
          currentUser.role === 'admin' ? (
            /* Admin Logged-In Flow */
            adminViewToggle === 'admin_panel' ? (
              <div className="w-full h-full min-h-screen flex flex-col">
                {/* Admin Quick Switch Navigation Header */}
                <div className="bg-zinc-900 border-b border-zinc-800 px-6 py-2 flex items-center justify-between text-xs">
                  <span className="text-zinc-500">{language === 'AR' ? 'لوحة المالك الرسمية' : 'Official Owner Panel'}</span>
                  <button
                    id="btn-switch-to-user-chat"
                    onClick={() => setAdminViewToggle('chat_view')}
                    className="py-1 px-3 bg-emerald-600/10 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <MessageSquare size={12} />
                    {language === 'AR' ? 'عرض واجهة غرف الدردشة كعضو' : 'View Chat Interface as Member'}
                  </button>
                </div>
                <div className="flex-1 w-full">
                  <AdminPanel
                    adminUser={currentUser}
                    onLogout={handleLogout}
                    language={language}
                    setLanguage={setLanguage}
                    isFirebaseReady={isFirebaseReady}
                    onEnterGroupChat={(group) => {
                      setSelectedGroupForChat(group);
                      setSelectedContactForChat(null);
                      setAdminViewToggle('chat_view');
                    }}
                    onEnterPrivateChat={(user) => {
                      setSelectedContactForChat(user);
                      setSelectedGroupForChat(null);
                      setAdminViewToggle('chat_view');
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="w-full h-full min-h-screen flex flex-col">
                {/* User Chat simulation Header for Admin */}
                <div className="bg-zinc-900 border-b border-zinc-800 px-6 py-2 flex items-center justify-between text-xs">
                  <span className="text-amber-400 font-bold flex items-center gap-1">
                    <Shield size={12} />
                    {language === 'AR' ? 'واجهة غرف الدردشة (وضع محاكاة العضو للأدمن)' : 'Chat Interface (Admin Simulation Mode)'}
                  </span>
                  <button
                    id="btn-switch-back-to-admin"
                    onClick={() => {
                      setSelectedGroupForChat(null);
                      setSelectedContactForChat(null);
                      setAdminViewToggle('admin_panel');
                    }}
                    className="py-1 px-3 bg-amber-600/10 hover:bg-amber-600 text-amber-400 hover:text-white rounded font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Shield size={12} />
                    {language === 'AR' ? 'الرجوع إلى لوحة تحكم المالك' : 'Back to Owner Panel'}
                  </button>
                </div>
                <div className="flex-1 w-full">
                  <ChatView
                    currentUser={currentUser}
                    initialInviteCode={inviteCode}
                    onLogout={handleLogout}
                    initialSelectedGroup={selectedGroupForChat}
                    initialSelectedContact={selectedContactForChat}
                    language={language}
                    setLanguage={setLanguage}
                    isFirebaseReady={isFirebaseReady}
                  />
                </div>
              </div>
            )
          ) : (
            /* Regular User Logged-In Flow */
            <div className="w-full h-full min-h-screen">
              <ChatView
                currentUser={currentUser}
                initialInviteCode={inviteCode}
                onLogout={handleLogout}
                language={language}
                setLanguage={setLanguage}
                isFirebaseReady={isFirebaseReady}
              />
            </div>
          )
        ) : (
          /* Unauthenticated Auth State (Sign up/Login) */
          <div className="w-full flex items-center justify-center p-4">
            <AuthView
              onAuthSuccess={handleAuthSuccess}
              initialIsAdmin={isAdminPathActive}
              language={language}
              setLanguage={setLanguage}
              isFirebaseReady={isFirebaseReady}
            />
          </div>
        )}
      </div>

      {/* Global Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            onClick={() => setToast(null)}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-11/12 max-w-sm bg-zinc-900/95 backdrop-blur-md border border-emerald-500/30 rounded-2xl p-4 shadow-2xl shadow-emerald-950/20 cursor-pointer flex items-start gap-3.5"
            dir={currentLangInfo.dir}
            id="global-toast-notif"
          >
            <div className="w-10 h-10 rounded-full bg-emerald-600/20 border border-emerald-500 flex items-center justify-center shrink-0 text-emerald-400">
              <Bell size={20} className="animate-pulse" />
            </div>
            <div className="flex-1 min-w-0 text-right">
              <h4 className="font-bold text-sm text-white">{toast.title}</h4>
              <p className="text-xs text-zinc-300 mt-1 leading-relaxed">{toast.body}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
