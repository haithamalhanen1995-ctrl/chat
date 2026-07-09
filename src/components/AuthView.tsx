import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, getDocs, doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore';
import { Shield, User, Key, CheckCircle, XCircle, Loader2, LogIn, UserPlus, Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TRANSLATIONS, LanguageCode, LANGUAGES } from '../lib/translations';

interface AuthViewProps {
  onAuthSuccess: (user: { id: string; role: 'admin' | 'user'; fullName: string; username: string }) => void;
  initialIsAdmin?: boolean;
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  isFirebaseReady: boolean;
}

export const ARAB_COUNTRIES = [
  { code: 'IQ', name: 'العراق', flag: '🇮🇶' },
  { code: 'SA', name: 'المملكة العربية السعودية', flag: '🇸🇦' },
  { code: 'EG', name: 'مصر', flag: '🇪🇬' },
  { code: 'DZ', name: 'الجزائر', flag: '🇩🇿' },
  { code: 'YE', name: 'اليمن', flag: '🇾🇪' },
  { code: 'MA', name: 'المغرب', flag: '🇲🇦' },
  { code: 'SY', name: 'سوريا', flag: '🇸🇾' },
  { code: 'TN', name: 'تونس', flag: '🇹🇳' },
  { code: 'SD', name: 'السودان', flag: '🇸🇩' },
  { code: 'SO', name: 'الصومال', flag: '🇸🇴' },
  { code: 'LY', name: 'ليبيا', flag: '🇱🇾' },
  { code: 'JO', name: 'الأردن', flag: '🇯🇴' },
  { code: 'AE', name: 'الإمارات العربية المتحدة', flag: '🇦🇪' },
  { code: 'KW', name: 'الكويت', flag: '🇰🇼' },
  { code: 'OM', name: 'عمان', flag: '🇴🇲' },
  { code: 'QA', name: 'قطر', flag: '🇶🇦' },
  { code: 'BH', name: 'البحرين', flag: '🇧🇭' },
  { code: 'PS', name: 'فلسطين', flag: '🇵🇸' },
  { code: 'LB', name: 'لبنان', flag: '🇱🇧' },
  { code: 'MR', name: 'موريتانيا', flag: '🇲🇷' },
  { code: 'DJ', name: 'جيبوتي', flag: '🇩🇯' },
  { code: 'KM', name: 'جزر القمر', flag: '🇰🇲' }
];

export const AuthView: React.FC<AuthViewProps> = ({ onAuthSuccess, initialIsAdmin = false, language, setLanguage, isFirebaseReady }) => {
  // Authentication Modes: 'login' (تسجيل الدخول) or 'register' (إنشاء حساب جديد)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

  const [siteName, setSiteName] = useState<string>('شات دجلة');
  const [showLangMenu, setShowLangMenu] = useState<boolean>(false);

  const t = (key: string) => {
    return TRANSLATIONS[language]?.[key] || TRANSLATIONS['AR']?.[key] || key;
  };

  useEffect(() => {
    if (!isFirebaseReady) return;
    const unsub = onSnapshot(doc(db, 'settings', 'site_config'), (snap) => {
      if (snap.exists()) {
        setSiteName(snap.data().siteName || 'شات دجلة');
      }
    });
    return () => unsub();
  }, [isFirebaseReady]);

  // Registration Fields
  const [fullName, setFullName] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [registerPassword, setRegisterPassword] = useState<string>('');
  const [selectedCountry, setSelectedCountry] = useState<string>('IQ');

  // Login Fields
  const [loginIdentifier, setLoginIdentifier] = useState<string>(initialIsAdmin ? 'admin' : '');
  const [loginPassword, setLoginPassword] = useState<string>('');

  // Username validation state
  const [isCheckingUsername, setIsCheckingUsername] = useState<boolean>(false);
  const [isUsernameUnique, setIsUsernameUnique] = useState<boolean | null>(null);
  const [usernameError, setUsernameError] = useState<string>('');

  // Status & Loading states
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  // Auto-fill username if requested via props
  useEffect(() => {
    if (initialIsAdmin) {
      setAuthMode('login');
      setLoginIdentifier('admin');
    }
  }, [initialIsAdmin]);

  // Real-time Username Availability Check for Registration
  useEffect(() => {
    if (authMode !== 'register' || username.trim().length < 3) {
      setIsUsernameUnique(null);
      setUsernameError(username.trim().length > 0 && username.trim().length < 3 ? 'يجب أن يكون اسم المستخدم 3 أحرف على الأقل' : '');
      return;
    }

    // RegEx to ensure safe alphanumeric + underscore character sets
    const validUsernameRegex = /^[a-zA-Z0-9_]+$/;
    if (!validUsernameRegex.test(username)) {
      setIsUsernameUnique(false);
      setUsernameError('يجب أن يحتوي اسم المستخدم على أحرف إنجليزية وأرقام وشرطة سفلية فقط بدون مسافات');
      return;
    }

    const checkUsernameUnique = async () => {
      if (!isFirebaseReady) return;
      setIsCheckingUsername(true);
      setUsernameError('');
      try {
        const uLower = username.trim().toLowerCase();
        
        // Dynamic admin username check
        const adminDoc = await getDoc(doc(db, 'users', 'admin_root'));
        const currentAdminUsername = adminDoc.exists() ? adminDoc.data().username || 'admin' : 'admin';

        if (uLower === currentAdminUsername || uLower === 'admin') {
          setIsUsernameUnique(false);
          setUsernameError('اسم المستخدم هذا محجوز لمالك المنصة');
          setIsCheckingUsername(false);
          return;
        }

        const q = query(collection(db, 'users'), where('username', '==', uLower));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          setIsUsernameUnique(false);
          setUsernameError('اسم المستخدم هذا مستخدم بالفعل');
        } else {
          setIsUsernameUnique(true);
          setUsernameError('');
        }
      } catch (err: any) {
        console.error('Error checking username unique:', err);
        setIsUsernameUnique(true);
      } finally {
        setIsCheckingUsername(false);
      }
    };

    const timer = setTimeout(() => {
      checkUsernameUnique();
    }, 500);

    return () => clearTimeout(timer);
  }, [username, authMode, isFirebaseReady]);

  // Submits a registration request (creates user directly with password)
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!isFirebaseReady) {
      setError(language === 'AR' ? 'جاري تهيئة الاتصال الآمن بالخلفية... يرجى الانتظار ثانية واحدة.' : 'Initializing secure connection in background... Please wait a second.');
      return;
    }

    if (!fullName.trim()) {
      setError('يرجى إدخال الاسم الكامل');
      return;
    }

    const uLower = username.trim().toLowerCase();
    if (uLower.length < 3) {
      setError('يجب أن يكون اسم المستخدم 3 أحرف على الأقل');
      return;
    }

    if (!registerPassword.trim()) {
      setError('يرجى إدخال كلمة المرور');
      return;
    }

    if (registerPassword.length < 4) {
      setError('يجب أن تكون كلمة المرور 4 أحرف على الأقل');
      return;
    }

    setIsLoading(true);

    try {
      // Direct double verification of username uniqueness
      const qUser = query(collection(db, 'users'), where('username', '==', uLower));
      const userSnap = await getDocs(qUser);
      if (!userSnap.empty) {
        setError('عذراً، اسم المستخدم هذا محجوز مسبقاً من مستخدم آخر.');
        setIsLoading(false);
        return;
      }

      // Generate a unique user ID
      const uid = `usr_${Math.random().toString(36).substring(2, 11)}`;
      const userRef = doc(db, 'users', uid);
      const userData = {
        id: uid,
        fullName: fullName.trim(),
        username: uLower,
        password: registerPassword.trim(),
        role: 'user' as const,
        status: 'active' as const,
        createdAt: new Date(),
        country: selectedCountry
      };

      await setDoc(userRef, userData);

      setSuccessMsg('تهانينا! تم إنشاء حسابك وتفعيله بنجاح 🎉');
      setTimeout(() => {
        onAuthSuccess({
          id: uid,
          role: 'user',
          fullName: userData.fullName,
          username: userData.username
        });
      }, 1000);
    } catch (err: any) {
      console.error('Registration error:', err);
      setError(`فشل إنشاء الحساب: ${err.message || 'خطأ غير معروف'}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Submits a login request (validates password, supports dynamic admin password)
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!isFirebaseReady) {
      setError(language === 'AR' ? 'جاري تهيئة الاتصال الآمن بالخلفية... يرجى الانتظار ثانية واحدة.' : 'Initializing secure connection in background... Please wait a second.');
      return;
    }

    const identifier = loginIdentifier.trim().toLowerCase();
    if (!identifier) {
      setError('يرجى إدخال اسم المستخدم');
      return;
    }

    if (!loginPassword.trim()) {
      setError('يرجى إدخال كلمة المرور');
      return;
    }

    setIsLoading(true);

    try {
      // Fetch current admin credentials from Firestore
      const adminDoc = await getDoc(doc(db, 'users', 'admin_root'));
      const adminUsername = adminDoc.exists() ? adminDoc.data().username || 'admin' : 'admin';
      const adminPasswordVal = adminDoc.exists() ? adminDoc.data().password || 'adminownerchat' : 'adminownerchat';

      // 1. Check if trying to login as Admin
      if (identifier === adminUsername) {
        if (loginPassword.trim() === adminPasswordVal) {
          // Sync admin document
          const adminId = 'admin_root';
          const adminRef = doc(db, 'users', adminId);
          await setDoc(adminRef, {
            id: adminId,
            fullName: 'مالك المنصة (أدمن)',
            username: adminUsername,
            password: adminPasswordVal,
            role: 'admin',
            status: 'active',
            createdAt: new Date()
          }, { merge: true });

          setSuccessMsg('مرحباً بك يا مدير المنصة. جاري الدخول للوحة التحكم...');
          setTimeout(() => {
            onAuthSuccess({
              id: adminId,
              role: 'admin',
              fullName: 'مالك المنصة (أدمن)',
              username: adminUsername
            });
          }, 1000);
        } else {
          setError('كلمة المرور الخاصة بمدير المنصة غير صحيحة!');
        }
        setIsLoading(false);
        return;
      }

      // 2. Regular User Login Lookup
      const q = query(collection(db, 'users'), where('username', '==', identifier));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        setError('اسم المستخدم هذا غير مسجل. يرجى إنشاء حساب جديد أولاً.');
        setIsLoading(false);
        return;
      }

      const targetUser = querySnapshot.docs[0].data();

      if (targetUser.status === 'banned') {
        setError('تم حظر هذا الحساب من قبل إدارة المنصة.');
        setIsLoading(false);
        return;
      }

      if (targetUser.password !== loginPassword.trim()) {
        setError('كلمة المرور غير صحيحة!');
        setIsLoading(false);
        return;
      }

      setSuccessMsg(`أهلاً بك مجدداً، ${targetUser.fullName} 👋`);
      setTimeout(() => {
        onAuthSuccess({
          id: querySnapshot.docs[0].id,
          role: 'user',
          fullName: targetUser.fullName,
          username: targetUser.username
        });
      }, 1000);
    } catch (err: any) {
      console.error('Login error:', err);
      setError(`خطأ أثناء تسجيل الدخول: ${err.message || 'خطأ غير معروف'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const isTryingAdmin = loginIdentifier.trim().toLowerCase() === 'admin';

  const currentLang = LANGUAGES.find(l => l.code === language) || LANGUAGES[0];

  return (
    <div className="w-full max-w-md bg-zinc-900 rounded-2xl border border-zinc-800 shadow-2xl p-6 md:p-8 relative" dir={currentLang.dir} id="auth-container-card">
      
      {/* Floating Language Switcher */}
      <div className="absolute top-4 left-4 z-25">
        <div className="relative">
          <button
            type="button"
            id="auth-lang-btn"
            onClick={() => setShowLangMenu(!showLangMenu)}
            className="w-9 h-9 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center transition-all cursor-pointer border border-zinc-700/50 hover:text-emerald-400"
            title="تغيير لغة الموقع / Change Site Language"
          >
            <Globe size={16} />
          </button>
          <AnimatePresence>
            {showLangMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowLangMenu(false)} />
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute top-11 left-0 mt-1 w-48 bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl z-50 py-1.5 max-h-64 overflow-y-auto"
                >
                  {LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => {
                        setLanguage(lang.code);
                        localStorage.setItem('chat_platform_language', lang.code);
                        setShowLangMenu(false);
                      }}
                      className={`w-full text-right px-4 py-2.5 text-xs flex items-center justify-between hover:bg-zinc-900 transition-colors cursor-pointer ${
                        language === lang.code ? 'text-emerald-400 font-bold bg-zinc-900/55' : 'text-zinc-300'
                      }`}
                    >
                      <span className="font-sans font-medium">{lang.nativeName}</span>
                      <span className="font-mono text-[10px] text-zinc-500 flex items-center gap-1.5">
                        {lang.flag} {lang.code}
                      </span>
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="text-center mb-6 pt-2">
        <h1 className="text-3xl font-sans font-bold tracking-tight text-white mb-2">
          {language === 'AR' ? `منصة ${siteName}` : `${siteName} Platform`}
        </h1>
        <p className="text-zinc-500 text-sm">
          {isTryingAdmin 
            ? (language === 'AR' ? 'لوحة تسجيل دخول مالك المنصة (الأدمن) 🔐' : 'Owner/Admin Secure Login 🔐') 
            : t('app_title')}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex bg-zinc-950 p-1 rounded-xl mb-6 border border-zinc-800" id="auth-mode-tabs">
        <button
          id="btn-login-mode"
          type="button"
          onClick={() => {
            setAuthMode('login');
            setError('');
            setSuccessMsg('');
          }}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer ${
            authMode === 'login' ? 'bg-emerald-600 text-white shadow-md' : 'text-zinc-400 hover:text-white hover:bg-zinc-900/40'
          }`}
        >
          <LogIn size={16} />
          {t('login')}
        </button>
        <button
          id="btn-register-mode"
          type="button"
          onClick={() => {
            setAuthMode('register');
            setError('');
            setSuccessMsg('');
          }}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer ${
            authMode === 'register' ? 'bg-emerald-600 text-white shadow-md' : 'text-zinc-400 hover:text-white hover:bg-zinc-900/40'
          }`}
        >
          <UserPlus size={16} />
          {t('register')}
        </button>
      </div>

      {/* Alerts */}
      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-4 p-3.5 bg-red-950/40 border border-red-900/60 rounded-xl text-red-400 text-xs text-right leading-relaxed"
            id="auth-error-msg"
          >
            {error}
          </motion.div>
        )}
        {successMsg && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-4 p-3.5 bg-emerald-950/40 border border-emerald-900/60 rounded-xl text-emerald-400 text-xs text-right leading-relaxed font-mono"
            id="auth-success-msg"
          >
            {successMsg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Forms Content */}
      {authMode === 'login' ? (
        /* Sign In Form */
        <form onSubmit={handleLoginSubmit} className="space-y-5" id="login-form">
          <div>
            <label htmlFor="login-id" className="block text-zinc-300 text-xs font-medium mb-1.5 mr-1 text-right">
              {t('username')}
            </label>
            <div className="relative">
              <input
                id="login-id"
                type="text"
                placeholder={language === 'AR' ? 'مثال: ali_iraq' : 'e.g. alex_smith'}
                value={loginIdentifier}
                onChange={(e) => setLoginIdentifier(e.target.value)}
                className="w-full h-12 pr-10 pl-4 bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:border-emerald-500 focus:outline-none text-right text-sm placeholder-zinc-500"
                required
              />
              <User size={18} className="absolute right-3 top-3.5 text-zinc-500" />
            </div>
          </div>

          <div>
            <label htmlFor="login-pwd" className="block text-zinc-300 text-xs font-medium mb-1.5 mr-1 text-right">
              {t('password')}
            </label>
            <div className="relative">
              <input
                id="login-pwd"
                type="password"
                placeholder="••••••••••••"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full h-12 pr-10 pl-4 bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:border-emerald-500 focus:outline-none text-right text-sm placeholder-zinc-500"
                required
              />
              <Key size={18} className="absolute right-3 top-3.5 text-zinc-500" />
            </div>
          </div>

          {isTryingAdmin && (
            <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800 text-right">
              <span className="text-[11px] text-emerald-400 block leading-relaxed">
                {language === 'AR' 
                  ? 'تم التعرف على حساب مالك المنصة. يرجى كتابة كلمة مرور الإدارة لتأكيد الدخول.'
                  : 'Owner account identified. Please write the management password to confirm access.'}
              </span>
            </div>
          )}

          <button
            id="btn-submit-login"
            type="submit"
            disabled={isLoading}
            className="w-full h-12 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 text-sm font-sans"
          >
            {isLoading ? (
              <>
                <Loader2 className="animate-spin" size={18} />
                {language === 'AR' ? 'جاري التحقق...' : 'Verifying...'}
              </>
            ) : isTryingAdmin ? (
              (language === 'AR' ? 'تسجيل دخول كمالك المنصة' : 'Login as Platform Owner')
            ) : (
              t('login')
            )}
          </button>
        </form>
      ) : (
        /* Sign Up Form */
        <form onSubmit={handleRegisterSubmit} className="space-y-5" id="register-form">
          {/* Full Name */}
          <div>
            <label htmlFor="reg-name" className="block text-zinc-300 text-xs font-medium mb-1.5 mr-1 text-right">
              {t('fullname')}
            </label>
            <div className="relative">
              <input
                id="reg-name"
                type="text"
                placeholder={language === 'AR' ? 'علي الرافدين' : 'Alex Smith'}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full h-12 pr-10 pl-4 bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:border-emerald-500 focus:outline-none text-right text-sm placeholder-zinc-500"
                required
              />
              <User size={18} className="absolute right-3 top-3.5 text-zinc-500" />
            </div>
          </div>

          {/* Username Check */}
          <div>
            <label htmlFor="reg-user" className="block text-zinc-300 text-xs font-medium mb-1.5 mr-1 text-right flex items-center justify-between">
              <span>{t('username')}</span>
              {isCheckingUsername && <Loader2 size={12} className="animate-spin text-zinc-400" />}
            </label>
            <div className="relative">
              <input
                id="reg-user"
                type="text"
                placeholder={language === 'AR' ? 'مثال: ali_99 (أحرف وأرقام إنجليزية فقط)' : 'e.g. alex99 (Alphanumeric/Underscore only)'}
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s+/g, ''))}
                className="w-full h-12 pr-10 pl-10 bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:border-emerald-500 focus:outline-none text-right text-sm placeholder-zinc-500 font-mono"
                required
              />
              <Shield size={18} className="absolute right-3 top-3.5 text-zinc-500" />
              
              {/* Visual Feedback Indicator */}
              <div className="absolute left-3 top-3.5 flex items-center justify-center">
                {isUsernameUnique === true && <CheckCircle size={18} className="text-emerald-500" />}
                {isUsernameUnique === false && <XCircle size={18} className="text-red-500" />}
              </div>
            </div>
            {usernameError && (
              <p className="mt-1 text-[11px] text-red-400 text-right leading-snug">{usernameError}</p>
            )}
            {isUsernameUnique === true && (
              <p className="mt-1 text-[11px] text-emerald-400 text-right font-medium">
                {language === 'AR' ? 'اسم المستخدم متاح ✔' : 'Username is available ✔'}
              </p>
            )}
          </div>

          {/* Arab Country Select */}
          <div>
            <label htmlFor="reg-country" className="block text-zinc-300 text-xs font-medium mb-1.5 mr-1 text-right">
              {t('country_label')}
            </label>
            <div className="relative">
              <select
                id="reg-country"
                value={selectedCountry}
                onChange={(e) => setSelectedCountry(e.target.value)}
                className="w-full h-12 pr-4 pl-10 bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:border-emerald-500 focus:outline-none text-right text-sm appearance-none cursor-pointer font-medium"
                required
              >
                {ARAB_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code} className="bg-zinc-900 text-white">
                    {c.flag} {c.name}
                  </option>
                ))}
              </select>
              <div className="absolute left-3 top-3.5 pointer-events-none text-zinc-500 text-[10px]">
                ▼
              </div>
            </div>
            <p className="mt-1 text-[10px] text-zinc-500 text-right">{t('country_desc')}</p>
          </div>

          {/* Password Input */}
          <div>
            <label htmlFor="reg-pwd" className="block text-zinc-300 text-xs font-medium mb-1.5 mr-1 text-right">
              {t('password')}
            </label>
            <div className="relative">
              <input
                id="reg-pwd"
                type="password"
                placeholder="••••••••••••"
                value={registerPassword}
                onChange={(e) => setRegisterPassword(e.target.value)}
                className="w-full h-12 pr-10 pl-4 bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:border-emerald-500 focus:outline-none text-right text-sm placeholder-zinc-500"
                required
              />
              <Key size={18} className="absolute right-3 top-3.5 text-zinc-500" />
            </div>
            <p className="mt-1 text-[10px] text-zinc-500 text-right">
              {language === 'AR' ? 'يرجى كتابة كلمة مرور لتسجيل الدخول بها لاحقاً' : 'Please choose a password to log in later'}
            </p>
          </div>

          <button
            id="btn-submit-register"
            type="submit"
            disabled={isLoading || isUsernameUnique === false}
            className="w-full h-12 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-sm font-sans"
          >
            {isLoading ? (
              <>
                <Loader2 className="animate-spin" size={18} />
                {language === 'AR' ? 'جاري إنشاء الحساب...' : 'Creating account...'}
              </>
            ) : (
              language === 'AR' ? 'إنشاء الحساب وتفعيل الدخول' : 'Create Account & Login'
            )}
          </button>
        </form>
      )}
    </div>
  );
};
