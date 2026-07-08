import React, { useState, useEffect } from 'react';
import { AuthView } from './components/AuthView';
import { ChatView } from './components/ChatView';
import { AdminPanel } from './components/AdminPanel';
import { Shield, MessageSquare, AlertCircle } from 'lucide-react';
import { ChatGroup, ChatUser } from './types';

interface UserSession {
  id: string;
  role: 'admin' | 'user';
  fullName: string;
  username: string;
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [isAdminPathActive, setIsAdminPathActive] = useState<boolean>(false);
  const [adminViewToggle, setAdminViewToggle] = useState<'admin_panel' | 'chat_view'>('admin_panel');
  const [selectedGroupForChat, setSelectedGroupForChat] = useState<ChatGroup | null>(null);
  const [selectedContactForChat, setSelectedContactForChat] = useState<ChatUser | null>(null);

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

  return (
    <div className="w-full min-h-screen bg-zinc-950 flex flex-col justify-between" dir="rtl" id="app-root-container">
      
      {/* Top Banner indicating special paths / statuses */}
      {isAdminPathActive && !currentUser && (
        <div className="w-full bg-amber-500/10 border-b border-amber-500/20 text-amber-400 py-2 px-4 text-xs text-center font-sans flex items-center justify-center gap-2">
          <Shield size={14} />
          أنت الآن تتصفح مسار المالك المحمي (/admin). يرجى تسجيل الدخول بحساب المدير.
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
                  <span className="text-zinc-500">لوحة المالك الرسمية</span>
                  <button
                    id="btn-switch-to-user-chat"
                    onClick={() => setAdminViewToggle('chat_view')}
                    className="py-1 px-3 bg-emerald-600/10 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <MessageSquare size={12} />
                    عرض واجهة غرف الدردشة كعضو
                  </button>
                </div>
                <div className="flex-1 w-full">
                  <AdminPanel
                    adminUser={currentUser}
                    onLogout={handleLogout}
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
                    واجهة غرف الدردشة (وضع محاكاة العضو للأدمن)
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
                    الرجوع إلى لوحة تحكم المالك
                  </button>
                </div>
                <div className="flex-1 w-full">
                  <ChatView
                    currentUser={currentUser}
                    initialInviteCode={inviteCode}
                    onLogout={handleLogout}
                    initialSelectedGroup={selectedGroupForChat}
                    initialSelectedContact={selectedContactForChat}
                  />
                </div>
              </div>
            )
          ) : (
            /* Regular User Logged-In Flow */
            <div className="w-full h-full min-h-screen">
              <ChatView currentUser={currentUser} initialInviteCode={inviteCode} onLogout={handleLogout} />
            </div>
          )
        ) : (
          /* Unauthenticated Auth State (Sign up/Login) */
          <div className="w-full flex items-center justify-center p-4">
            <AuthView onAuthSuccess={handleAuthSuccess} initialIsAdmin={isAdminPathActive} />
          </div>
        )}
      </div>

      {/* Small Decorative Footer */}
      <footer className="bg-zinc-950 border-t border-zinc-900/60 py-3.5 text-center text-[10px] text-zinc-600 select-none font-sans flex items-center justify-center gap-2">
        <span>© ٢٠٢٦ منصة شات دجلة. جميع الحقوق محفوظة لمالك المنصة.</span>
      </footer>
    </div>
  );
}
