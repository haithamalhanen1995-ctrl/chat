import React, { useState, useEffect } from 'react';
import { db, storage } from '../firebase';
import {
  collection,
  onSnapshot,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  query,
  where,
  writeBatch
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { ChatUser, ChatGroup, GroupMessage, GroupMember, PrivateMessage } from '../types';
import {
  Users,
  MessageSquare,
  PlusCircle,
  Link2,
  Trash2,
  Ban,
  Check,
  UserCheck,
  Edit2,
  Send,
  LogOut,
  FolderPlus,
  Shield,
  Activity,
  UserPlus,
  X,
  FileImage,
  MessageCircle,
  Eraser,
  AlertCircle,
  Globe
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TRANSLATIONS, LanguageCode, LANGUAGES } from '../lib/translations';

// Helper to compress selected images to small JPEG Base64
const compressImageToBase64 = (file: File, maxDim: number = 400, quality: number = 0.6): Promise<string> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } else {
          resolve(e.target?.result as string || '');
        }
      };
      img.onerror = () => {
        resolve(e.target?.result as string || '');
      };
      img.src = e.target?.result as string;
    };
    reader.onerror = () => {
      resolve('');
    };
    reader.readAsDataURL(file);
  });
};

// Helper to upload bytes with a strict timeout (e.g., 2500ms)
const uploadBytesWithTimeout = (storageRef: any, file: File, timeoutMs: number = 2500) => {
  return Promise.race([
    uploadBytes(storageRef, file),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Storage upload timeout')), timeoutMs)
    )
  ]);
};

// Helper to wrap any promise with a timeout
const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number = 5000): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('انتهت مهلة الاتصال بالخادم. يرجى التحقق من اتصال الإنترنت.')), timeoutMs)
    )
  ]);
};

interface AdminPanelProps {
  adminUser: { id: string; fullName: string; username: string };
  onLogout: () => void;
  onEnterGroupChat?: (group: ChatGroup) => void;
  onEnterPrivateChat?: (user: ChatUser) => void;
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  isFirebaseReady: boolean;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  adminUser,
  onLogout,
  onEnterGroupChat,
  onEnterPrivateChat,
  language,
  setLanguage,
  isFirebaseReady
}) => {
  const [showLangMenu, setShowLangMenu] = useState<boolean>(false);

  const t = (key: string) => {
    return TRANSLATIONS[language]?.[key] || TRANSLATIONS['AR']?.[key] || key;
  };
  // Database States
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [allMessages, setAllMessages] = useState<GroupMessage[]>([]);

  // Selected sub-tabs in admin panel: 'stats', 'users', 'groups', 'dms'
  const [activeTab, setActiveTab] = useState<'stats' | 'users' | 'groups' | 'dms' | 'owner_settings'>('stats');

  // Admin Profile Credentials Change States
  const [adminNewUsername, setAdminNewUsername] = useState<string>('');
  const [adminNewPassword, setAdminNewPassword] = useState<string>('');

  // Loading & Action states
  const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  // Site Name Configurations
  const [siteName, setSiteName] = useState<string>('شات دجلة');
  const [siteNameInput, setSiteNameInput] = useState<string>('');
  const [siteConfigLoading, setSiteConfigLoading] = useState<boolean>(false);
  const [siteConfigSuccess, setSiteConfigSuccess] = useState<string>('');
  const [siteConfigError, setSiteConfigError] = useState<string>('');

  // Create Group Form
  const [groupName, setGroupName] = useState<string>('');
  const [groupDesc, setGroupDesc] = useState<string>('');
  const [groupImageFile, setGroupImageFile] = useState<File | null>(null);
  const [groupImagePreview, setGroupImagePreview] = useState<string>('');
  const [groupImageUrl, setGroupImageUrl] = useState<string>('');

  // Retrospective Message Eraser state
  const [selectedEraseGroup, setSelectedEraseGroup] = useState<string>('');
  const [eraseTimeframe, setEraseTimeframe] = useState<string>('all'); // 'all', '1h', '24h'

  // Edit User Modal
  const [editingUser, setEditingUser] = useState<ChatUser | null>(null);
  const [editFullName, setEditFullName] = useState<string>('');
  const [editUsername, setEditUsername] = useState<string>('');
  const [editPhone, setEditPhone] = useState<string>('');

  // Custom Confirmation Dialog State to replace window.confirm (broken in sandboxed iframe)
  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'delete_user' | 'delete_group' | 'erase_messages';
    title: string;
    message: string;
    payload: any;
  } | null>(null);

  // DM State
  const [selectedDmUser, setSelectedDmUser] = useState<ChatUser | null>(null);
  const [dmText, setDmText] = useState<string>('');
  const [privateChats, setPrivateChats] = useState<{ [userId: string]: PrivateMessage[] }>({});

  // Group Members Panel
  const [selectedGroupForMembers, setSelectedGroupForMembers] = useState<ChatGroup | null>(null);
  const [groupMembersMap, setGroupMembersMap] = useState<{ [groupId: string]: string[] }>({}); // maps groupId to userIds
  const [memberSearchQuery, setMemberSearchQuery] = useState<string>('');

  // Listeners
  useEffect(() => {
    if (!isFirebaseReady) return;
    // 1. Listen to users
    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      const fetchedUsers: ChatUser[] = [];
      snapshot.forEach((doc) => {
        fetchedUsers.push(doc.data() as ChatUser);
      });
      // Filter out admin themselves from users list if needed, or keep
      setUsers(fetchedUsers);
    });

    // 2. Listen to groups
    const unsubGroups = onSnapshot(collection(db, 'groups'), (snapshot) => {
      const fetchedGroups: ChatGroup[] = [];
      snapshot.forEach((doc) => {
        fetchedGroups.push(doc.data() as ChatGroup);
      });
      setGroups(fetchedGroups);
    });

    // 3. Listen to all messages (for stats and deletion)
    const unsubMsgs = onSnapshot(collection(db, 'messages'), (snapshot) => {
      const fetchedMsgs: GroupMessage[] = [];
      snapshot.forEach((doc) => {
        fetchedMsgs.push(doc.data() as GroupMessage);
      });
      setAllMessages(fetchedMsgs);
    });

    // 4. Listen to GroupMembers to map who is in what group
    const unsubMembers = onSnapshot(collection(db, 'groupMembers'), (snapshot) => {
      const tempMembersMap: { [groupId: string]: string[] } = {};
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.groupId && data.userId) {
          if (!tempMembersMap[data.groupId]) {
            tempMembersMap[data.groupId] = [];
          }
          tempMembersMap[data.groupId].push(data.userId);
        }
      });
      setGroupMembersMap(tempMembersMap);
    });

    // 5. Listen to all private messages for DM view
    const unsubPrivateMsgs = onSnapshot(collection(db, 'privateMessages'), (snapshot) => {
      const tempChats: { [userId: string]: PrivateMessage[] } = {};
      snapshot.forEach((doc) => {
        const msg = doc.data() as PrivateMessage;
        // The chatId is usually adminId_userId or similar
        const otherUserId = msg.senderId === adminUser.id ? msg.receiverId : msg.senderId;
        if (!tempChats[otherUserId]) {
          tempChats[otherUserId] = [];
        }
        tempChats[otherUserId].push(msg);
      });

      // Sort messages by time
      Object.keys(tempChats).forEach((userId) => {
        tempChats[userId].sort((a, b) => {
          const t1 = a.createdAt?.seconds || 0;
          const t2 = b.createdAt?.seconds || 0;
          return t1 - t2;
        });
      });

      setPrivateChats(tempChats);
    });

    return () => {
      unsubUsers();
      unsubGroups();
      unsubMsgs();
      unsubMembers();
      unsubPrivateMsgs();
    };
  }, [adminUser.id, isFirebaseReady]);

  // Fetch admin dynamic credentials on load
  useEffect(() => {
    if (!isFirebaseReady) return;
    const fetchAdminCreds = async () => {
      try {
        const adminDoc = await getDoc(doc(db, 'users', 'admin_root'));
        if (adminDoc.exists()) {
          const data = adminDoc.data();
          setAdminNewUsername(data.username || 'admin');
          setAdminNewPassword(data.password || 'adminownerchat');
        } else {
          setAdminNewUsername('admin');
          setAdminNewPassword('adminownerchat');
        }
      } catch (err) {
        console.error('Error fetching admin credentials on load:', err);
      }
    };
    fetchAdminCreds();
  }, [isFirebaseReady]);

  // Update dynamic admin login credentials
  const handleUpdateAdminCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!adminNewUsername.trim() || adminNewUsername.trim().toLowerCase().includes(' ')) {
      setErrorMsg('اسم المستخدم لا يمكن أن يكون فارغاً أو يحتوي على مسافات.');
      return;
    }
    if (adminNewPassword.trim().length < 4) {
      setErrorMsg('يجب أن تكون كلمة المرور 4 أحرف على الأقل.');
      return;
    }

    setIsActionLoading(true);

    try {
      const adminRef = doc(db, 'users', 'admin_root');
      await setDoc(adminRef, {
        id: 'admin_root',
        fullName: 'مالك المنصة (أدمن)',
        username: adminNewUsername.trim().toLowerCase(),
        password: adminNewPassword.trim(),
        role: 'admin',
        status: 'active',
        createdAt: new Date()
      }, { merge: true });

      setSuccessMsg('تم تحديث بيانات تسجيل دخول المدير (الأدمن) بنجاح!');
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      console.error('Error updating admin creds:', err);
      setErrorMsg(`فشل تحديث بيانات المدير: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  // Real-time listener for site configuration settings
  useEffect(() => {
    if (!isFirebaseReady) return;
    const unsub = onSnapshot(doc(db, 'settings', 'site_config'), (snap) => {
      if (snap.exists()) {
        const name = snap.data().siteName || 'شات دجلة';
        setSiteName(name);
        setSiteNameInput(name);
      } else {
        setSiteName('شات دجلة');
        setSiteNameInput('شات دجلة');
      }
    });
    return () => unsub();
  }, [isFirebaseReady]);

  const handleUpdateSiteName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!siteNameInput.trim()) return;

    setSiteConfigLoading(true);
    setSiteConfigSuccess('');
    setSiteConfigError('');

    try {
      await setDoc(doc(db, 'settings', 'site_config'), {
        siteName: siteNameInput.trim()
      }, { merge: true });

      setSiteConfigSuccess('تم تحديث اسم الموقع بنجاح!');
      setTimeout(() => setSiteConfigSuccess(''), 4000);
    } catch (err: any) {
      console.error('Error updating site name:', err);
      setSiteConfigError(`فشل التحديث: ${err.message}`);
    } finally {
      setSiteConfigLoading(false);
    }
  };

  // Utility to copy invite link
  const copyInviteLink = (inviteCode: string) => {
    // Generate actual app url invite link
    const inviteLink = `${window.location.origin}${window.location.pathname}?invite=${inviteCode}`;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setSuccessMsg('تم نسخ رابط الدعوة بنجاح بنقرة واحدة! يمكنك مشاركته الآن.');
      setTimeout(() => setSuccessMsg(''), 4000);
    }).catch(() => {
      alert(`رابط الدعوة: ${inviteLink}`);
    });
  };

  // Compress and handle Image Select
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setGroupImageFile(file);

      // Create local preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setGroupImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Group Create handler
  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!groupName.trim()) {
      setErrorMsg('يرجى كتابة اسم المجموعة');
      return;
    }

    setIsActionLoading(true);

    try {
      const groupId = `group_${Math.random().toString(36).substring(2, 11)}`;
      const inviteCode = Math.random().toString(36).substring(2, 7).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();

      let finalPhotoUrl = groupImageUrl.trim();

      // If file uploaded, try Firebase Storage with timeout, else use compressed local Base64
      if (groupImageFile) {
        try {
          const compressedBase64 = await compressImageToBase64(groupImageFile);
          try {
            const storageRef = ref(storage, `groups/${groupId}`);
            const snapshot = await uploadBytesWithTimeout(storageRef, groupImageFile, 2500);
            finalPhotoUrl = await getDownloadURL(snapshot.ref);
          } catch (storageErr) {
            console.warn('Firebase Storage upload failed or timed out, using compressed base64 fallback:', storageErr);
            finalPhotoUrl = compressedBase64 || groupImagePreview || '';
          }
        } catch (compressErr) {
          console.error('Error compressing group image:', compressErr);
          finalPhotoUrl = groupImagePreview || '';
        }
      }

      // Default avatar if none provided
      if (!finalPhotoUrl) {
        finalPhotoUrl = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(groupName)}`;
      }

      const groupRef = doc(db, 'groups', groupId);
      const groupData: ChatGroup = {
        id: groupId,
        name: groupName.trim(),
        description: groupDesc.trim() || '',
        photoUrl: finalPhotoUrl,
        inviteCode: inviteCode,
        createdBy: adminUser.id,
        createdAt: new Date()
      };

      await withTimeout(setDoc(groupRef, groupData), 4500);

      // Create initial Invite Link document
      const inviteRef = doc(db, 'inviteLinks', inviteCode);
      await withTimeout(setDoc(inviteRef, {
        id: inviteCode,
        groupId: groupId,
        createdAt: new Date()
      }), 4500);

      // Auto add admin to this group
      const adminMemberRef = doc(db, 'groupMembers', `${groupId}_${adminUser.id}`);
      await withTimeout(setDoc(adminMemberRef, {
        id: `${groupId}_${adminUser.id}`,
        groupId: groupId,
        userId: adminUser.id,
        joinedAt: new Date()
      }), 4500);

      setSuccessMsg(`تم إنشاء المجموعة "${groupName}" وتوليد رمز الدعوة: ${inviteCode}`);
      
      // Reset form
      setGroupName('');
      setGroupDesc('');
      setGroupImageUrl('');
      setGroupImageFile(null);
      setGroupImagePreview('');

    } catch (err: any) {
      console.error('Error creating group:', err);
      setErrorMsg(`فشل إنشاء المجموعة: ${err.message || 'حدث خطأ غير معروف'}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  // Erase group messages retrospectively
  const handleEraseMessages = async (bypassConfirm: boolean = false) => {
    if (!selectedEraseGroup) {
      setErrorMsg('يرجى تحديد المجموعة أولاً');
      return;
    }

    if (!bypassConfirm) {
      setConfirmDialog({
        type: 'erase_messages',
        title: 'سحب وحذف رسائل الكروب',
        message: 'هل أنت متأكد من رغبتك في حذف الرسائل المحددة؟ لا يمكن التراجع عن هذا الإجراء.',
        payload: {}
      });
      return;
    }

    setIsActionLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      // Fetch messages of this group
      const q = query(collection(db, 'messages'), where('groupId', '==', selectedEraseGroup));
      const querySnapshot = await getDocs(q);

      const batch = writeBatch(db);
      let count = 0;
      const now = new Date().getTime();

      querySnapshot.forEach((docSnap) => {
        const msg = docSnap.data();
        const msgTime = msg.createdAt?.seconds ? msg.createdAt.seconds * 1000 : now;

        let shouldDelete = false;

        if (eraseTimeframe === 'all') {
          shouldDelete = true;
        } else if (eraseTimeframe === '1h') {
          // older than 1 hour or newer than 1 hour? The requirement says "سحب/حذف رسائل بأثر رجعي"
          // Let's delete ALL messages or messages from last 1 hour, or older than 1 hour.
          // Usually retrospective withdrawal means deleting recent messages (e.g., from the last 1 hour) or all messages.
          // Let's implement both or clear recent ones! Let's delete ALL messages in the chosen group to be safe or based on selected timeframe.
          // Let's delete messages sent in the last 1 hour
          const oneHourAgo = now - 60 * 60 * 1000;
          if (msgTime >= oneHourAgo) {
            shouldDelete = true;
          }
        } else if (eraseTimeframe === '24h') {
          const oneDayAgo = now - 24 * 60 * 60 * 1000;
          if (msgTime >= oneDayAgo) {
            shouldDelete = true;
          }
        }

        if (shouldDelete) {
          batch.delete(docSnap.ref);
          count++;
        }
      });

      if (count > 0) {
        await batch.commit();
        setSuccessMsg(`تم سحب وحذف ${count} رسالة بأثر رجعي بنجاح!`);
      } else {
        setSuccessMsg('لا توجد رسائل مطابقة للفترة المحددة.');
      }
    } catch (err: any) {
      console.error('Error erasing group messages:', err);
      setErrorMsg(`فشل سحب الرسائل: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  // User Actions: Edit User
  const handleOpenEditUser = (user: ChatUser) => {
    setEditingUser(user);
    setEditFullName(user.fullName);
    setEditUsername(user.username);
    setEditPhone(user.password || ''); // Re-use editPhone state to hold password
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setErrorMsg('');
    setSuccessMsg('');

    setIsActionLoading(true);

    try {
      const uLower = editUsername.trim().toLowerCase();

      // Check unique username if username changed
      if (uLower !== editingUser.username) {
        const q = query(collection(db, 'users'), where('username', '==', uLower));
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          setErrorMsg('اسم المستخدم هذا مستخدم بالفعل بحساب آخر');
          setIsActionLoading(false);
          return;
        }
      }

      // Update
      const userRef = doc(db, 'users', editingUser.id);
      await updateDoc(userRef, {
        fullName: editFullName.trim(),
        username: uLower,
        password: editPhone.trim() // store updated password
      });

      setSuccessMsg(`تم تحديث بيانات المستخدم "${editFullName}" بنجاح.`);
      setEditingUser(null);
    } catch (err: any) {
      console.error('Error updating user:', err);
      setErrorMsg(`فشل التحديث: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  // Toggle User Ban
  const handleToggleUserBan = async (user: ChatUser) => {
    if (user.role === 'admin') {
      setErrorMsg('لا يمكنك حظر حساب المالك!');
      return;
    }
    setErrorMsg('');
    setSuccessMsg('');

    const newStatus = user.status === 'banned' ? 'active' : 'banned';
    try {
      const userRef = doc(db, 'users', user.id);
      await updateDoc(userRef, {
        status: newStatus
      });
      setSuccessMsg(`تم تغيير حالة المستخدم إلى ${newStatus === 'banned' ? 'محظور 🚫' : 'نشط ✔'}`);
    } catch (err: any) {
      console.error('Error toggling ban:', err);
      setErrorMsg(`فشل تعديل حالة المستخدم: ${err.message}`);
    }
  };

  // Delete User Account Entirely with maximum robustness
  const handleDeleteUser = async (userId: string, userFullName: string, bypassConfirm: boolean = false) => {
    if (userId === 'admin_root') {
      setErrorMsg('لا يمكنك حذف حساب المالك!');
      return;
    }

    if (!bypassConfirm) {
      setConfirmDialog({
        type: 'delete_user',
        title: 'حذف حساب مستخدم نهائياً',
        message: `هل أنت متأكد من حذف حساب المستخدم "${userFullName}" نهائياً من قاعدة البيانات؟ سيتم فقدان صلاحية دخوله وسيتم حذف جميع رسائله وانضماماته للكروبات ولا يمكن التراجع عن هذا الإجراء.`,
        payload: { userId, userFullName }
      });
      return;
    }

    setIsActionLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      // 1. Delete from users collection
      try {
        await deleteDoc(doc(db, 'users', userId));
      } catch (err: any) {
        console.error('Error deleting user doc:', err);
      }

      // 2. Delete memberships
      try {
        const membershipsQuery = query(collection(db, 'groupMembers'), where('userId', '==', userId));
        const membershipsSnap = await getDocs(membershipsQuery);
        const batch = writeBatch(db);
        let ops = 0;
        membershipsSnap.forEach((docSnap) => {
          batch.delete(docSnap.ref);
          ops++;
        });
        if (ops > 0) {
          await batch.commit();
        }
      } catch (err: any) {
        console.error('Error deleting memberships during user deletion:', err);
      }

      // 3. Delete messages
      try {
        const msgsQuery = query(collection(db, 'messages'), where('senderId', '==', userId));
        const msgsSnap = await getDocs(msgsQuery);
        const batch = writeBatch(db);
        let ops = 0;
        msgsSnap.forEach((docSnap) => {
          batch.delete(docSnap.ref);
          ops++;
        });
        if (ops > 0) {
          await batch.commit();
        }
      } catch (err: any) {
        console.error('Error deleting user messages during user deletion:', err);
      }

      setSuccessMsg(`تم حذف حساب المستخدم "${userFullName}" وكل عضوياته ورسائله بنجاح.`);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      console.error('Error deleting user sequence:', err);
      setErrorMsg(`فشل حذف المستخدم: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  // Group Members management: Add a member to group
  const handleAddMemberToGroup = async (userId: string) => {
    if (!selectedGroupForMembers) return;
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const memberId = `${selectedGroupForMembers.id}_${userId}`;
      const memberRef = doc(db, 'groupMembers', memberId);
      
      await setDoc(memberRef, {
        id: memberId,
        groupId: selectedGroupForMembers.id,
        userId: userId,
        joinedAt: new Date()
      });

      setSuccessMsg('تم إضافة العضو بنجاح للمجموعة!');
    } catch (err: any) {
      console.error('Error adding group member:', err);
      setErrorMsg(`فشل إضافة العضو: ${err.message}`);
    }
  };

  // Group Members management: Remove a member from group
  const handleRemoveMemberFromGroup = async (userId: string) => {
    if (!selectedGroupForMembers) return;
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const memberId = `${selectedGroupForMembers.id}_${userId}`;
      await deleteDoc(doc(db, 'groupMembers', memberId));
      setSuccessMsg('تم إزالة العضو من المجموعة بنجاح.');
    } catch (err: any) {
      console.error('Error removing group member:', err);
      setErrorMsg(`فشل إزالة العضو: ${err.message}`);
    }
  };

  // Delete Group completely
  const handleDeleteGroup = async (groupId: string, groupName: string, bypassConfirm: boolean = false) => {
    if (!bypassConfirm) {
      setConfirmDialog({
        type: 'delete_group',
        title: 'حذف كروب بالكامل',
        message: `هل أنت متأكد من حذف كروب "${groupName}" نهائياً مع كافة رسائله وأعضائه؟ لا يمكن التراجع عن هذا الإجراء.`,
        payload: { groupId, groupName }
      });
      return;
    }

    setErrorMsg('');
    setSuccessMsg('');

    try {
      // 1. Delete group document
      await deleteDoc(doc(db, 'groups', groupId));

      // 2. Delete all memberships of this group
      const qMembers = query(collection(db, 'groupMembers'), where('groupId', '==', groupId));
      const snapMembers = await getDocs(qMembers);
      const batch = writeBatch(db);
      snapMembers.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      // 3. Delete all messages of this group
      const qMessages = query(collection(db, 'messages'), where('groupId', '==', groupId));
      const snapMessages = await getDocs(qMessages);
      snapMessages.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      // 4. Delete associated invite links
      const qInvites = query(collection(db, 'inviteLinks'), where('groupId', '==', groupId));
      const snapInvites = await getDocs(qInvites);
      snapInvites.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      await batch.commit();
      setSuccessMsg(`تم حذف كروب "${groupName}" بالكامل مع البيانات التابعة له.`);
    } catch (err: any) {
      console.error('Error deleting group:', err);
      setErrorMsg(`فشل حذف الكروب: ${err.message}`);
    }
  };

  // Send Admin Private DM message
  const handleSendAdminDm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDmUser || !dmText.trim()) return;

    try {
      const messageId = `pmsg_${Math.random().toString(36).substring(2, 11)}`;
      const chatId = `admin_${selectedDmUser.id}`;

      const pmRef = doc(db, 'privateMessages', messageId);
      await setDoc(pmRef, {
        id: messageId,
        chatId: chatId,
        senderId: adminUser.id,
        receiverId: selectedDmUser.id,
        text: dmText.trim(),
        createdAt: new Date(),
        read: false
      });

      setDmText('');
    } catch (err) {
      console.error('Error sending DM:', err);
    }
  };

  const getUnreadDmsCount = () => {
    let unreadCount = 0;
    Object.keys(privateChats).forEach((userId) => {
      privateChats[userId].forEach((msg) => {
        if (msg.senderId !== adminUser.id && !msg.read) {
          unreadCount++;
        }
      });
    });
    return unreadCount;
  };

  // General Statistics Calculations
  const statsUsersCount = users.length;
  const statsGroupsCount = groups.length;
  const statsMessagesCount = allMessages.length;

  return (
    <div className="w-full min-h-screen bg-zinc-950 text-white font-sans flex flex-col md:flex-row-reverse" dir={t('dir')} id="admin-panel-layout">
      {/* Admin Sidebar Navigation */}
      <div className="w-full md:w-64 bg-zinc-900 border-b md:border-b-0 md:border-l border-zinc-800 p-5 flex flex-col justify-between" id="admin-sidebar">
        <div className="space-y-6">
          <div className="flex items-center gap-3 pb-5 border-b border-zinc-800">
            <div className="w-10 h-10 bg-emerald-600/20 text-emerald-400 rounded-xl flex items-center justify-center">
              <Shield size={22} />
            </div>
            <div>
              <h2 className="font-bold text-sm leading-tight text-white">{language === 'AR' ? 'لوحة تحكم المالك' : 'Owner Control Panel'}</h2>
              <p className="text-[11px] text-zinc-500 mt-0.5">{siteName}</p>
            </div>
          </div>

          <nav className="space-y-1.5 flex flex-col" id="admin-nav-links">
            <button
              id="admin-tab-stats"
              onClick={() => setActiveTab('stats')}
              className={`w-full py-3 px-4 rounded-xl text-right text-sm font-medium flex items-center gap-3 transition-colors ${
                activeTab === 'stats' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              <Activity size={18} />
              {language === 'AR' ? 'الإحصائيات والتحكم العام' : 'Stats & General Control'}
            </button>
            <button
              id="admin-tab-groups"
              onClick={() => setActiveTab('groups')}
              className={`w-full py-3 px-4 rounded-xl text-right text-sm font-medium flex items-center gap-3 transition-colors ${
                activeTab === 'groups' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              <FolderPlus size={18} />
              {language === 'AR' ? `إدارة الكروبات (${statsGroupsCount})` : `Manage Groups (${statsGroupsCount})`}
            </button>
            <button
              id="admin-tab-users"
              onClick={() => setActiveTab('users')}
              className={`w-full py-3 px-4 rounded-xl text-right text-sm font-medium flex items-center gap-3 transition-colors ${
                activeTab === 'users' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              <Users size={18} />
              {language === 'AR' ? `إدارة المستخدمين (${statsUsersCount})` : `Manage Users (${statsUsersCount})`}
            </button>
            <button
              id="admin-tab-dms"
              onClick={() => setActiveTab('dms')}
              className={`w-full py-3 px-4 rounded-xl text-right text-sm font-medium flex items-center justify-between transition-colors ${
                activeTab === 'dms' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <MessageCircle size={18} />
                <span>{language === 'AR' ? 'الرسائل الخاصة (DM)' : 'Private Messages (DM)'}</span>
              </div>
              {getUnreadDmsCount() > 0 && (
                <span className="bg-red-500 text-white text-[9px] font-bold h-4.5 min-w-4.5 px-1.5 rounded-full flex items-center justify-center animate-bounce shadow-md">
                  {getUnreadDmsCount()}
                </span>
              )}
            </button>
            <button
              id="admin-tab-owner-settings"
              onClick={() => setActiveTab('owner_settings')}
              className={`w-full py-3 px-4 rounded-xl text-right text-sm font-medium flex items-center gap-3 transition-colors ${
                activeTab === 'owner_settings' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              <Shield size={18} />
              {language === 'AR' ? 'إعدادات حساب المدير' : 'Admin Account Settings'}
            </button>
          </nav>
        </div>

        <div className="pt-6 border-t border-zinc-800 mt-6 md:mt-0 flex flex-col gap-2 relative">
          {/* Quick Language Switcher inside Admin Panel footer */}
          <div className="relative w-full">
            <button
              type="button"
              id="admin-quick-lang-btn"
              onClick={() => setShowLangMenu(!showLangMenu)}
              className="w-full py-2.5 px-4 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 rounded-lg text-xs font-medium flex items-center justify-between transition-colors cursor-pointer border border-zinc-700/30"
            >
              <span className="flex items-center gap-2">
                <Globe size={14} />
                <span>{language === 'AR' ? 'لغة لوحة التحكم' : 'Panel Language'}</span>
              </span>
              <span className="text-[10px] font-mono text-zinc-500">
                {(LANGUAGES.find(l => l.code === language) || LANGUAGES[0]).flag} {language}
              </span>
            </button>
            <AnimatePresence>
              {showLangMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowLangMenu(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute bottom-11 left-0 right-0 mt-1 bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl z-50 py-1 max-h-48 overflow-y-auto"
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
                        className={`w-full text-right px-4 py-2 text-xs flex items-center justify-between hover:bg-zinc-900 transition-colors cursor-pointer ${
                          language === lang.code ? 'text-emerald-400 font-bold bg-zinc-900/50' : 'text-zinc-300'
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

          <button
            id="admin-btn-logout"
            onClick={onLogout}
            className="w-full py-2.5 px-4 bg-zinc-800 hover:bg-red-950/40 hover:text-red-400 text-zinc-400 rounded-lg text-sm font-medium flex items-center gap-2 justify-center transition-colors cursor-pointer"
          >
            <LogOut size={16} />
            {language === 'AR' ? 'تسجيل خروج الأدمن' : 'Logout Admin'}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 p-6 md:p-8 overflow-y-auto max-h-screen" id="admin-main-stage">
        {/* Banner notification */}
        {successMsg && (
          <div className="mb-6 p-4 bg-emerald-950/40 border border-emerald-800 text-emerald-400 rounded-xl text-xs text-right font-mono" id="admin-alert-success">
            {successMsg}
          </div>
        )}
        {errorMsg && (
          <div className="mb-6 p-4 bg-red-950/40 border border-red-800 text-red-400 rounded-xl text-xs text-right" id="admin-alert-error">
            {errorMsg}
          </div>
        )}

        {/* 1. STATS TAB */}
        {activeTab === 'stats' && (
          <div className="space-y-8" id="tab-content-stats">
            <div>
              <h1 className="text-2xl font-bold font-sans">الرئيسية والإحصائيات العامة</h1>
              <p className="text-zinc-400 text-xs mt-1">مراقبة فورية لنشاط وأداء منصة {siteName}</p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" id="admin-stats-grid">
              <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl flex items-center justify-between">
                <div>
                  <span className="text-zinc-500 text-xs font-medium block">إجمالي المستخدمين</span>
                  <span className="text-3xl font-sans font-bold mt-1 block">{statsUsersCount}</span>
                </div>
                <div className="w-12 h-12 bg-blue-500/10 text-blue-400 rounded-xl flex items-center justify-center">
                  <Users size={24} />
                </div>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl flex items-center justify-between">
                <div>
                  <span className="text-zinc-500 text-xs font-medium block">عدد مجموعات الدردشة</span>
                  <span className="text-3xl font-sans font-bold mt-1 block">{statsGroupsCount}</span>
                </div>
                <div className="w-12 h-12 bg-emerald-500/10 text-emerald-400 rounded-xl flex items-center justify-center">
                  <FolderPlus size={24} />
                </div>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl flex items-center justify-between">
                <div>
                  <span className="text-zinc-500 text-xs font-medium block">إجمالي الرسائل المرسلة</span>
                  <span className="text-3xl font-sans font-bold mt-1 block">{statsMessagesCount}</span>
                </div>
                <div className="w-12 h-12 bg-purple-500/10 text-purple-400 rounded-xl flex items-center justify-center">
                  <MessageSquare size={24} />
                </div>
              </div>
            </div>

            {/* Messages Eraser Section */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4" id="admin-eraser-box">
              <div className="flex items-center gap-3 pb-3 border-b border-zinc-800">
                <Eraser className="text-red-400" size={20} />
                <div>
                  <h3 className="font-bold text-sm">سحب وحذف الرسائل بأثر رجعي</h3>
                  <p className="text-[11px] text-zinc-500 mt-0.5">حذف الرسائل بشكل فوري وجماعي من مجموعة معينة</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <div>
                  <label htmlFor="erase-group-select" className="block text-zinc-400 text-xs mb-2 text-right">المجموعة المستهدفة</label>
                  <select
                    id="erase-group-select"
                    value={selectedEraseGroup}
                    onChange={(e) => setSelectedEraseGroup(e.target.value)}
                    className="w-full h-11 px-3 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-right focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">-- اختر مجموعة --</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="erase-timeframe" className="block text-zinc-400 text-xs mb-2 text-right">الفترة الزمنية</label>
                  <select
                    id="erase-timeframe"
                    value={eraseTimeframe}
                    onChange={(e) => setEraseTimeframe(e.target.value)}
                    className="w-full h-11 px-3 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-right focus:outline-none focus:border-emerald-500"
                  >
                    <option value="all">كل الرسائل منذ التأسيس</option>
                    <option value="1h">الرسائل المرسلة في آخر ساعة فقط</option>
                    <option value="24h">الرسائل المرسلة في آخر 24 ساعة فقط</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <button
                    id="btn-erase-messages-submit"
                    onClick={handleEraseMessages}
                    className="w-full h-11 bg-red-600 hover:bg-red-500 text-white font-medium rounded-xl text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Trash2 size={16} />
                    حذف وسحب الرسائل المحددة
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2. GROUPS MANAGER TAB */}
        {activeTab === 'groups' && (
          <div className="space-y-8" id="tab-content-groups">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold font-sans">إدارة المجموعات (الكروبات)</h1>
                <p className="text-zinc-400 text-xs mt-1">إنشاء كروبات جديدة وتعديلها وإدارة أعضائها وحذفها بالكامل</p>
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 bg-red-950/40 border border-red-800/40 text-red-400 text-xs rounded-xl text-right">
                {errorMsg}
              </div>
            )}
            {successMsg && (
              <div className="p-3 bg-emerald-950/40 border border-emerald-800/40 text-emerald-400 text-xs rounded-xl text-right">
                {successMsg}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Form: Create Group */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4 lg:col-span-1 h-fit">
                <h3 className="font-bold text-sm flex items-center gap-2 pb-3 border-b border-zinc-800 text-white">
                  <PlusCircle size={18} className="text-emerald-500" />
                  إنشاء مجموعة جديدة
                </h3>

                <form onSubmit={handleCreateGroup} className="space-y-4" id="create-group-form">
                  <div>
                    <label htmlFor="grp-name" className="block text-zinc-400 text-xs mb-1.5 text-right">اسم المجموعة (مطلوب)</label>
                    <input
                      id="grp-name"
                      type="text"
                      placeholder="كروب شباب بابل"
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      className="w-full h-11 px-3 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-right focus:outline-none focus:border-emerald-500 text-white"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="grp-desc" className="block text-zinc-400 text-xs mb-1.5 text-right">الوصف (اختياري)</label>
                    <textarea
                      id="grp-desc"
                      placeholder="اكتب نبذة مختصرة عن هذا الكروب..."
                      value={groupDesc}
                      onChange={(e) => setGroupDesc(e.target.value)}
                      rows={3}
                      className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-right focus:outline-none focus:border-emerald-500 text-white resize-none"
                    />
                  </div>

                  {/* Group Image Source Selector */}
                  <div>
                    <label className="block text-zinc-400 text-xs mb-1.5 text-right">صورة الكروب</label>
                    <div className="space-y-3">
                      {/* Image Upload Button */}
                      <div className="flex items-center gap-3">
                        <label className="flex-1 h-11 bg-zinc-950 border border-dashed border-zinc-700 hover:border-emerald-500 rounded-lg flex items-center justify-center gap-2 cursor-pointer text-xs text-zinc-400 transition-colors">
                          <FileImage size={16} />
                          رفع صورة من الجهاز
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleImageChange}
                            className="hidden"
                          />
                        </label>
                        {groupImagePreview && (
                          <div className="w-11 h-11 rounded-lg overflow-hidden border border-zinc-700">
                            <img src={groupImagePreview} alt="Preview" className="w-full h-full object-cover" />
                          </div>
                        )}
                      </div>

                      <div className="text-center text-[10px] text-zinc-500">أو أدخل رابط صورة مباشر</div>
                      <input
                        id="grp-img-url"
                        type="url"
                        placeholder="https://example.com/photo.png"
                        value={groupImageUrl}
                        onChange={(e) => setGroupImageUrl(e.target.value)}
                        className="w-full h-11 px-3 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-right focus:outline-none focus:border-emerald-500 font-mono text-xs text-white"
                      />
                    </div>
                  </div>

                  <button
                    id="btn-submit-group"
                    type="submit"
                    disabled={isActionLoading}
                    className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isActionLoading ? 'جاري الإنشاء...' : 'إنشاء وتوليد رابط الدعوة'}
                  </button>
                </form>
              </div>

              {/* Right: Groups List */}
              <div className="lg:col-span-2 space-y-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5" id="groups-list-container">
                  <h3 className="font-bold text-sm pb-3 border-b border-zinc-800 mb-4 text-white">المجموعات النشطة ({groups.length})</h3>

                  {groups.length === 0 ? (
                    <p className="text-zinc-500 text-xs text-center py-8">لا توجد مجموعات حالياً. ابدأ بإنشاء أول كروب بالاستمارة المجاورة.</p>
                  ) : (
                    <div className="space-y-4" id="admin-groups-list">
                      {groups.map((group) => {
                        const membersCount = groupMembersMap[group.id]?.length || 0;
                        return (
                          <div key={group.id} className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                            <div className="flex items-center gap-3">
                              <img
                                src={group.photoUrl || `https://api.dicebear.com/7.x/identicon/svg?seed=${group.id}`}
                                alt={group.name}
                                className="w-12 h-12 rounded-xl object-cover bg-zinc-800 border border-zinc-700"
                              />
                              <div>
                                <h4 className="font-bold text-sm text-white">{group.name}</h4>
                                <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{group.description || 'بدون وصف'}</p>
                                <span className="text-[10px] text-zinc-500 mt-1 block">الأعضاء: {membersCount} • كود الدعوة: {group.inviteCode}</span>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              {onEnterGroupChat && (
                                <button
                                  id={`btn-enter-chat-${group.id}`}
                                  onClick={() => onEnterGroupChat(group)}
                                  className="h-9 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                                  title="دخول غرف دردشة المجموعة"
                                >
                                  <MessageSquare size={14} />
                                  دخول المحادثة
                                </button>
                              )}

                              <button
                                id={`btn-copy-invite-${group.id}`}
                                onClick={() => copyInviteLink(group.inviteCode)}
                                className="h-9 px-3 bg-emerald-600/10 text-emerald-400 hover:bg-emerald-600 hover:text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                                title="نسخ رابط الدعوة"
                              >
                                <Link2 size={14} />
                                رابط الدعوة
                              </button>

                              <button
                                id={`btn-manage-members-${group.id}`}
                                onClick={() => setSelectedGroupForMembers(group)}
                                className="h-9 px-3 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                              >
                                <Users size={14} />
                                إدارة الأعضاء
                              </button>

                              <button
                                id={`btn-delete-group-${group.id}`}
                                onClick={() => handleDeleteGroup(group.id, group.name)}
                                className="h-9 w-9 bg-red-950/40 text-red-400 hover:bg-red-600 hover:text-white rounded-lg flex items-center justify-center transition-colors cursor-pointer"
                                title="حذف الكروب نهائياً"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Sub-Modal: Manage Group Members */}
            <AnimatePresence>
              {selectedGroupForMembers && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
                  id="members-modal"
                >
                  <motion.div
                    initial={{ scale: 0.95 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0.95 }}
                    className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg p-6 max-h-[85vh] flex flex-col text-right"
                    dir="rtl"
                  >
                    <div className="flex items-center justify-between pb-4 border-b border-zinc-800 mb-4">
                      <h3 className="font-bold text-base text-white">إدارة أعضاء مجموعة: {selectedGroupForMembers.name}</h3>
                      <button
                        id="btn-close-members-modal"
                        onClick={() => setSelectedGroupForMembers(null)}
                        className="text-zinc-400 hover:text-white"
                      >
                        <X size={20} />
                      </button>
                    </div>

                    {/* Member search */}
                    <div className="mb-4">
                      <input
                        id="member-search-input"
                        type="text"
                        placeholder="ابحث عن اسم العضو لإضافته أو حذفه..."
                        value={memberSearchQuery}
                        onChange={(e) => setMemberSearchQuery(e.target.value)}
                        className="w-full h-11 px-4 bg-zinc-950 border border-zinc-800 rounded-xl text-sm focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                      {/* Current Members List */}
                      <div>
                        <h4 className="text-xs text-zinc-400 font-bold mb-2">أعضاء المجموعة الحاليين:</h4>
                        <div className="space-y-2">
                          {users
                            .filter((u) => groupMembersMap[selectedGroupForMembers.id]?.includes(u.id))
                            .filter((u) => u.fullName.includes(memberSearchQuery) || u.username.includes(memberSearchQuery))
                            .map((u) => (
                              <div key={u.id} className="bg-zinc-950 p-2.5 rounded-lg flex items-center justify-between">
                                <div className="text-right">
                                  <span className="text-xs font-bold block text-white">{u.fullName}</span>
                                  <span className="text-[10px] text-zinc-400 font-mono">@{u.username}</span>
                                </div>
                                <button
                                  id={`btn-remove-member-${u.id}`}
                                  onClick={() => handleRemoveMemberFromGroup(u.id)}
                                  className="h-8 px-2.5 bg-red-950/40 text-red-400 hover:bg-red-600 hover:text-white rounded-md text-xs font-medium transition-colors"
                                >
                                  إزالة عضو
                                </button>
                              </div>
                            ))}
                        </div>
                      </div>

                      {/* Non-members to add */}
                      <div className="border-t border-zinc-800 pt-4 mt-4">
                        <h4 className="text-xs text-zinc-400 font-bold mb-2">المستخدمين المسجلين (إضافة للكروب):</h4>
                        <div className="space-y-2">
                          {users
                            .filter((u) => !groupMembersMap[selectedGroupForMembers.id]?.includes(u.id))
                            .filter((u) => u.fullName.includes(memberSearchQuery) || u.username.includes(memberSearchQuery))
                            .map((u) => (
                              <div key={u.id} className="bg-zinc-950 p-2.5 rounded-lg flex items-center justify-between">
                                <div className="text-right">
                                  <span className="text-xs font-bold block text-white">{u.fullName}</span>
                                  <span className="text-[10px] text-zinc-400 font-mono">@{u.username}</span>
                                </div>
                                <button
                                  id={`btn-add-member-${u.id}`}
                                  onClick={() => handleAddMemberToGroup(u.id)}
                                  className="h-8 px-2.5 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white rounded-md text-xs font-medium transition-colors"
                                >
                                  إضافة عضو
                                </button>
                              </div>
                            ))}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* 3. USERS MANAGER TAB */}
        {activeTab === 'users' && (
          <div className="space-y-8" id="tab-content-users">
            <div>
              <h1 className="text-2xl font-bold font-sans">إدارة المستخدمين</h1>
              <p className="text-zinc-400 text-xs mt-1">تعديل بيانات المستخدمين، حظرهم، تفعيلهم، وحذف حساباتهم بشكل كامل</p>
            </div>

            {errorMsg && (
              <div className="p-3 bg-red-950/40 border border-red-800/40 text-red-400 text-xs rounded-xl text-right">
                {errorMsg}
              </div>
            )}
            {successMsg && (
              <div className="p-3 bg-emerald-950/40 border border-emerald-800/40 text-emerald-400 text-xs rounded-xl text-right">
                {successMsg}
              </div>
            )}

            {/* Users Table / List */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 overflow-x-auto" id="users-table-container">
              <table className="w-full text-right" dir="rtl">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400 text-xs font-semibold">
                    <th className="pb-3 pr-4">الاسم الكامل</th>
                    <th className="pb-3">اسم المستخدم (@)</th>
                    <th className="pb-3">كلمة المرور</th>
                    <th className="pb-3">الحالة</th>
                    <th className="pb-3 text-center">الإجراءات والتحكم</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 text-sm" id="admin-users-table-rows">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-zinc-950/40">
                      <td className="py-4 pr-4 font-bold text-white">{user.fullName}</td>
                      <td className="py-4 font-mono text-xs text-zinc-300">@{user.username}</td>
                      <td className="py-4 font-mono text-xs text-zinc-400">{user.password || '—'}</td>
                      <td className="py-4">
                        {user.status === 'banned' ? (
                          <span className="px-2 py-0.5 bg-red-950/50 border border-red-800 text-red-400 rounded-full text-[10px] font-semibold">محظور 🚫</span>
                        ) : (
                          <span className="px-2 py-0.5 bg-emerald-950/50 border border-emerald-800 text-emerald-400 rounded-full text-[10px] font-semibold">نشط ✔</span>
                        )}
                      </td>
                      <td className="py-4">
                        <div className="flex items-center justify-center gap-2">
                          {/* DM Button */}
                          <button
                            id={`btn-user-dm-${user.id}`}
                            onClick={() => {
                              setSelectedDmUser(user);
                              setActiveTab('dms');
                            }}
                            className="h-8 px-3 bg-blue-600/10 hover:bg-blue-600 text-blue-400 hover:text-white rounded-lg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                            title="إرسال رسالة خاصة DM"
                          >
                            <MessageSquare size={12} />
                            مراسلة
                          </button>

                          {/* Chat simulator DM button */}
                          {onEnterPrivateChat && (
                            <button
                              id={`btn-user-simulator-dm-${user.id}`}
                              onClick={() => onEnterPrivateChat(user)}
                              className="h-8 px-3 bg-emerald-600/10 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded-lg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                              title="مراسلة العضو مباشرة في شات الأعضاء"
                            >
                              <MessageSquare size={12} />
                              دردشة فورية
                            </button>
                          )}

                          {/* Edit Button */}
                          <button
                            id={`btn-user-edit-${user.id}`}
                            onClick={() => handleOpenEditUser(user)}
                            className="h-8 w-8 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
                            title="تعديل البيانات"
                          >
                            <Edit2 size={12} />
                          </button>

                          {/* Ban Button */}
                          <button
                            id={`btn-user-ban-${user.id}`}
                            onClick={() => handleToggleUserBan(user)}
                            disabled={user.role === 'admin'}
                            className={`h-8 px-2.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors disabled:opacity-50 cursor-pointer ${
                              user.status === 'banned'
                                ? 'bg-emerald-950/40 hover:bg-emerald-600 text-emerald-400 hover:text-white'
                                : 'bg-red-950/40 hover:bg-red-600 text-red-400 hover:text-white'
                            }`}
                          >
                            {user.status === 'banned' ? <UserCheck size={12} /> : <Ban size={12} />}
                            {user.status === 'banned' ? 'تفعيل' : 'حظر'}
                          </button>

                          {/* Delete Account */}
                          <button
                            id={`btn-user-delete-${user.id}`}
                            onClick={() => handleDeleteUser(user.id, user.fullName)}
                            disabled={user.role === 'admin'}
                            className="h-8 w-8 bg-red-950/40 hover:bg-red-600 text-red-400 hover:text-white rounded-lg flex items-center justify-center transition-colors disabled:opacity-50 cursor-pointer"
                            title="حذف الحساب نهائياً"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Sub-Modal: Edit User Details */}
            <AnimatePresence>
              {editingUser && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
                  id="edit-user-modal"
                >
                  <motion.div
                    initial={{ scale: 0.95 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0.95 }}
                    className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 text-right"
                    dir="rtl"
                  >
                    <div className="flex items-center justify-between pb-4 border-b border-zinc-800 mb-4">
                      <h3 className="font-bold text-base text-white">تعديل بيانات المستخدم: {editingUser.fullName}</h3>
                      <button
                        id="btn-close-edit-modal"
                        onClick={() => setEditingUser(null)}
                        className="text-zinc-400 hover:text-white"
                      >
                        <X size={20} />
                      </button>
                    </div>

                    <form onSubmit={handleUpdateUser} className="space-y-4" id="edit-user-form">
                      <div>
                        <label htmlFor="edit-usr-fullname" className="block text-zinc-400 text-xs mb-1.5 text-right">الاسم الكامل</label>
                        <input
                          id="edit-usr-fullname"
                          type="text"
                          value={editFullName}
                          onChange={(e) => setEditFullName(e.target.value)}
                          className="w-full h-11 px-3 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-right focus:outline-none focus:border-emerald-500"
                          required
                        />
                      </div>

                      <div>
                        <label htmlFor="edit-usr-username" className="block text-zinc-400 text-xs mb-1.5 text-right">اسم المستخدم (@)</label>
                        <input
                          id="edit-usr-username"
                          type="text"
                          value={editUsername}
                          onChange={(e) => setEditUsername(e.target.value)}
                          className="w-full h-11 px-3 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-right focus:outline-none focus:border-emerald-500 font-mono"
                          required
                        />
                      </div>

                      <div>
                        <label htmlFor="edit-usr-phone" className="block text-zinc-400 text-xs mb-1.5 text-right">كلمة المرور</label>
                        <input
                          id="edit-usr-phone"
                          type="text"
                          value={editPhone}
                          onChange={(e) => setEditPhone(e.target.value)}
                          className="w-full h-11 px-3 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-right focus:outline-none focus:border-emerald-500 font-mono"
                          required
                        />
                      </div>

                      <div className="flex gap-2 pt-2">
                        <button
                          id="btn-submit-edit-user"
                          type="submit"
                          disabled={isActionLoading}
                          className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg text-sm transition-colors cursor-pointer"
                        >
                          حفظ التعديلات
                        </button>
                        <button
                          id="btn-cancel-edit-user"
                          type="button"
                          onClick={() => setEditingUser(null)}
                          className="px-4 h-11 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition-colors"
                        >
                          إلغاء
                        </button>
                      </div>
                    </form>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* 4. DMS TAB */}
        {activeTab === 'dms' && (
          <div className="h-[80vh] flex flex-col sm:flex-row-reverse gap-4" id="tab-content-dms">
            {/* Users lists for DM */}
            <div className="w-full sm:w-64 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col">
              <h3 className="font-bold text-xs text-zinc-400 mb-3 text-right">بدء محادثة خاصة (DM)</h3>
              <div className="flex-1 overflow-y-auto space-y-2 pr-1" id="dm-users-list">
                {users
                  .filter((u) => u.id !== adminUser.id)
                  .map((user) => (
                    <button
                      id={`btn-select-dm-${user.id}`}
                      key={user.id}
                      onClick={() => setSelectedDmUser(user)}
                      className={`w-full p-2.5 rounded-xl text-right transition-all flex items-center gap-3 ${
                        selectedDmUser?.id === user.id ? 'bg-emerald-600/20 border border-emerald-500/55' : 'bg-zinc-950 hover:bg-zinc-800 border border-transparent'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-300 border border-zinc-700">
                        {user.fullName.substring(0, 1)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-bold block text-white truncate text-right">{user.fullName}</span>
                        <span className="text-[10px] text-zinc-500 font-mono block text-right">@{user.username}</span>
                      </div>
                    </button>
                  ))}
              </div>
            </div>

            {/* Chat message stage */}
            <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl flex flex-col overflow-hidden">
              {selectedDmUser ? (
                <>
                  {/* Chat header */}
                  <div className="p-4 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-emerald-600/20 text-emerald-400 flex items-center justify-center text-sm font-bold border border-emerald-500/20">
                        {selectedDmUser.fullName.substring(0, 1)}
                      </div>
                      <div className="text-right">
                        <h4 className="font-bold text-sm text-white">{selectedDmUser.fullName}</h4>
                        <p className="text-[10px] text-emerald-400">محادثة خاصة ومباشرة</p>
                      </div>
                    </div>
                  </div>

                  {/* Message log */}
                  <div className="flex-1 p-4 overflow-y-auto space-y-3 flex flex-col" id="dm-message-log">
                    {(privateChats[selectedDmUser.id] || []).length === 0 ? (
                      <div className="my-auto text-center space-y-2 text-zinc-500 text-xs">
                        <MessageSquare className="mx-auto text-zinc-600" size={32} />
                        <p>لا توجد رسائل بينك وبين {selectedDmUser.fullName} بعد.</p>
                        <p className="text-[10px]">اكتب رسالة بالأسفل وسيباشر المستخدم باستلامها فوراً.</p>
                      </div>
                    ) : (
                      (privateChats[selectedDmUser.id] || []).map((msg) => {
                        const isAdminSender = msg.senderId === adminUser.id;
                        return (
                          <div
                            key={msg.id}
                            className={`flex flex-col max-w-[80%] ${
                              isAdminSender ? 'self-start items-start' : 'self-end items-end'
                            }`}
                          >
                            <div
                              className={`p-3 rounded-2xl text-xs text-right leading-relaxed ${
                                isAdminSender
                                  ? 'bg-emerald-600 text-white rounded-br-none'
                                  : 'bg-zinc-800 text-zinc-100 rounded-bl-none'
                              }`}
                            >
                              {msg.text}
                            </div>
                            <span className="text-[9px] text-zinc-500 mt-1">
                              {msg.createdAt?.seconds
                                ? `${new Date(msg.createdAt.seconds * 1000).toLocaleDateString('ar-IQ', { year: 'numeric', month: 'numeric', day: 'numeric' })} - ${new Date(msg.createdAt.seconds * 1000).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })}`
                                : ''}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Message Input bar */}
                  <form onSubmit={handleSendAdminDm} className="p-3 bg-zinc-950 border-t border-zinc-800 flex gap-2" id="dm-input-bar">
                    <input
                      id="dm-text-input"
                      type="text"
                      placeholder="اكتب رسالتك الخاصة والآمنة هنا..."
                      value={dmText}
                      onChange={(e) => setDmText(e.target.value)}
                      className="flex-1 h-11 px-4 bg-zinc-900 border border-zinc-800 rounded-xl text-xs focus:outline-none focus:border-emerald-500 text-right"
                      required
                    />
                    <button
                      id="btn-send-dm"
                      type="submit"
                      className="w-11 h-11 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl flex items-center justify-center transition-colors cursor-pointer shrink-0"
                    >
                      <Send size={16} className="transform rotate-180" />
                    </button>
                  </form>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 text-xs gap-3">
                  <MessageCircle size={40} className="text-zinc-600 animate-pulse" />
                  <span>الرجاء اختيار مستخدم من القائمة الجانبية لبدء المراسلة الفورية</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 5. OWNER SETTINGS TAB */}
        {activeTab === 'owner_settings' && (
          <div className="space-y-8" id="tab-content-owner-settings">
            <div>
              <h1 className="text-2xl font-bold font-sans text-white">إعدادات حساب المدير والموقع</h1>
              <p className="text-zinc-400 text-xs mt-1">تعديل بيانات تسجيل دخول الأدمن والتحكم باسم المنصة بالكامل في مكان واحد</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Card 1: Admin Credentials */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6" id="owner-settings-card">
                <h3 className="font-bold text-sm text-white mb-4">تحديث بيانات الدخول للأدمن</h3>
                
                {errorMsg && (
                  <div className="p-3 mb-4 bg-red-950/40 border border-red-800/40 text-red-400 text-xs rounded-xl text-right">
                    {errorMsg}
                  </div>
                )}
                {successMsg && (
                  <div className="p-3 mb-4 bg-emerald-950/40 border border-emerald-800/40 text-emerald-400 text-xs rounded-xl text-right">
                    {successMsg}
                  </div>
                )}

                <form onSubmit={handleUpdateAdminCredentials} className="space-y-4" id="admin-creds-form">
                  <div>
                    <label htmlFor="admin-new-username" className="block text-zinc-400 text-xs mb-1.5 text-right">اسم مستخدم المدير الجديد</label>
                    <input
                      id="admin-new-username"
                      type="text"
                      value={adminNewUsername}
                      onChange={(e) => setAdminNewUsername(e.target.value)}
                      placeholder="مثال: admin"
                      className="w-full h-11 px-3 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-right focus:outline-none focus:border-emerald-500 font-mono text-white"
                      required
                    />
                    <p className="text-[10px] text-zinc-500 mt-1">يجب أن يكون بدون مسافات وبأحرف صغيرة أو أرقام.</p>
                  </div>

                  <div>
                    <label htmlFor="admin-new-password" className="block text-zinc-400 text-xs mb-1.5 text-right">كلمة مرور المدير الجديدة</label>
                    <input
                      id="admin-new-password"
                      type="password"
                      value={adminNewPassword}
                      onChange={(e) => setAdminNewPassword(e.target.value)}
                      placeholder="أدخل كلمة مرور جديدة"
                      className="w-full h-11 px-3 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-right focus:outline-none focus:border-emerald-500 text-white"
                      required
                    />
                    <p className="text-[10px] text-zinc-500 mt-1">يجب أن تكون على الأقل 4 خانات لتأمين حسابك.</p>
                  </div>

                  <button
                    id="btn-submit-admin-creds"
                    type="submit"
                    disabled={isActionLoading}
                    className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg text-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
                  >
                    {isActionLoading ? 'جاري التحديث...' : 'حفظ التغييرات'}
                  </button>
                </form>
              </div>

              {/* Card 2: Site Name Config */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6" id="site-settings-card">
                <h3 className="font-bold text-sm text-white mb-4">إعدادات الموقع العامة</h3>
                
                {siteConfigError && (
                  <div className="p-3 mb-4 bg-red-950/40 border border-red-800/40 text-red-400 text-xs rounded-xl text-right">
                    {siteConfigError}
                  </div>
                )}
                {siteConfigSuccess && (
                  <div className="p-3 mb-4 bg-emerald-950/40 border border-emerald-800/40 text-emerald-400 text-xs rounded-xl text-right">
                    {siteConfigSuccess}
                  </div>
                )}

                <form onSubmit={handleUpdateSiteName} className="space-y-4" id="site-config-form">
                  <div>
                    <label htmlFor="site-name-input" className="block text-zinc-400 text-xs mb-1.5 text-right">اسم الموقع</label>
                    <input
                      id="site-name-input"
                      type="text"
                      value={siteNameInput}
                      onChange={(e) => setSiteNameInput(e.target.value)}
                      placeholder="أدخل اسم الموقع الجديد"
                      className="w-full h-11 px-3 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-right focus:outline-none focus:border-emerald-500 text-white font-bold"
                      required
                    />
                    <p className="text-[10px] text-zinc-500 mt-1">هذا هو الاسم الذي يظهر للمستخدمين في شريط العنوان والصفحات الرئيسية.</p>
                  </div>

                  <button
                    id="btn-submit-site-name"
                    type="submit"
                    disabled={siteConfigLoading}
                    className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg text-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
                  >
                    {siteConfigLoading ? 'جاري التحديث...' : 'حفظ اسم الموقع'}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Custom Confirmation Dialog (Works inside sandboxed iframe without blocking) */}
      <AnimatePresence>
        {confirmDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
            id="confirm-dialog-overlay"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 text-right"
              dir="rtl"
            >
              <div className="flex items-center gap-3 pb-3 border-b border-zinc-800 mb-4 text-red-400">
                <AlertCircle size={22} className="shrink-0" />
                <h3 className="font-bold text-base text-white">{confirmDialog.title}</h3>
              </div>

              <p className="text-zinc-300 text-xs leading-relaxed mb-6">
                {confirmDialog.message}
              </p>

              <div className="flex justify-end gap-2.5">
                <button
                  type="button"
                  id="btn-confirm-cancel"
                  onClick={() => setConfirmDialog(null)}
                  className="h-10 px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  id="btn-confirm-execute"
                  disabled={isActionLoading}
                  onClick={async () => {
                    const { type, payload } = confirmDialog;
                    try {
                      if (type === 'delete_user') {
                        await handleDeleteUser(payload.userId, payload.userFullName, true);
                      } else if (type === 'delete_group') {
                        await handleDeleteGroup(payload.groupId, payload.groupName, true);
                      } else if (type === 'erase_messages') {
                        await handleEraseMessages(true);
                      }
                    } catch (e) {
                      console.error("Confirmation execution error:", e);
                    } finally {
                      setConfirmDialog(null);
                    }
                  }}
                  className="h-10 px-5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  {isActionLoading ? 'جاري التنفيذ...' : 'نعم، تنفيذ الإجراء'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
