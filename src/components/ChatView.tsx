import React, { useState, useEffect, useRef } from 'react';
import { db, storage } from '../firebase';
import {
  collection,
  onSnapshot,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { ChatUser, ChatGroup, GroupMessage, GroupMember, PrivateMessage, InAppNotification } from '../types';
import {
  MessageSquare,
  Users,
  Send,
  Plus,
  Image as ImageIcon,
  Edit2,
  Trash2,
  Check,
  CheckCheck,
  X,
  Lock,
  UserCheck,
  LogOut,
  AlertCircle,
  Link,
  MessageCircle,
  Volume2,
  Smile,
  Bell,
  Globe
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ARAB_COUNTRIES } from './AuthView';
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

interface ChatViewProps {
  currentUser: { id: string; role: 'admin' | 'user'; fullName: string; username: string };
  initialInviteCode?: string | null;
  onLogout: () => void;
  initialSelectedGroup?: ChatGroup | null;
  initialSelectedContact?: ChatUser | null;
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  isFirebaseReady: boolean;
}

export const ChatView: React.FC<ChatViewProps> = ({
  currentUser,
  initialInviteCode,
  onLogout,
  initialSelectedGroup = null,
  initialSelectedContact = null,
  language,
  setLanguage,
  isFirebaseReady
}) => {
  // Main structural states
  const [activeMode, setActiveMode] = useState<'groups' | 'dms' | 'contacts'>(initialSelectedContact ? 'dms' : 'groups');
  const [showLangMenu, setShowLangMenu] = useState<boolean>(false);

  const t = (key: string) => {
    return TRANSLATIONS[language]?.[key] || TRANSLATIONS['AR']?.[key] || key;
  };
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ChatGroup | null>(initialSelectedGroup);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [userMemberships, setUserMemberships] = useState<string[]>([]); // Array of group IDs user is in

  // DM State
  const [selectedContact, setSelectedContact] = useState<ChatUser | null>(initialSelectedContact);
  const [privateMessages, setPrivateMessages] = useState<PrivateMessage[]>([]);
  const [isSelectedDmActive, setIsSelectedDmActive] = useState<boolean>(initialSelectedContact ? true : false);

  // React to parent-controlled selections
  useEffect(() => {
    if (initialSelectedGroup) {
      setSelectedGroup(initialSelectedGroup);
      setSelectedContact(null);
      setIsSelectedDmActive(false);
      setActiveMode('groups');
    }
  }, [initialSelectedGroup]);

  useEffect(() => {
    if (initialSelectedContact) {
      setSelectedContact(initialSelectedContact);
      setSelectedGroup(null);
      setIsSelectedDmActive(true);
      setActiveMode('dms');
    }
  }, [initialSelectedContact]);

  const unreadCount = privateMessages.filter(
    (m) => m.receiverId === currentUser.id && m.read !== true
  ).length;

  const getUserUnreadDmCount = (userId: string) => {
    return privateMessages.filter(
      (m) => m.chatId === `admin_${userId}` && m.receiverId === currentUser.id && m.read !== true
    ).length;
  };

  const getUserFlag = (userId: string) => {
    const user = allUsers.find((u) => u.id === userId);
    if (!user || !user.country) return '';
    const countryObj = ARAB_COUNTRIES.find((c) => c.code === user.country);
    return countryObj ? countryObj.flag : '';
  };

  const getCurrentUserFlag = () => {
    if (!currentUserProfile?.country) return '';
    const countryObj = ARAB_COUNTRIES.find((c) => c.code === currentUserProfile.country);
    return countryObj ? countryObj.flag : '';
  };

  const currentChatMessages = currentUser.role === 'admin'
    ? privateMessages.filter((m) => m.chatId === `admin_${selectedContact?.id}`)
    : privateMessages;

  // In-App Notifications State
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [showNotificationsDropdown, setShowNotificationsDropdown] = useState<boolean>(false);

  // Helper to create notifications
  const createNotification = async (userId: string, title: string, body: string, type: 'mention' | 'new_message' | 'private_message', chatId: string) => {
    try {
      const notifId = `notif_${Math.random().toString(36).substring(2, 11)}`;
      await setDoc(doc(db, 'notifications', notifId), {
        id: notifId,
        userId,
        title,
        body,
        type,
        chatId,
        isRead: false,
        createdAt: new Date(),
        senderName: currentUser.fullName
      });
    } catch (e) {
      console.warn("Failed to create notification:", e);
    }
  };

  // Listen to notifications in real-time
  useEffect(() => {
    if (!isFirebaseReady) return;
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', currentUser.id)
    );

    const unsubNotifs = onSnapshot(q, (snapshot) => {
      const fetchedNotifs: InAppNotification[] = [];
      snapshot.forEach((doc) => {
        fetchedNotifs.push(doc.data() as InAppNotification);
      });

      // Sort client-side by createdAt descending
      fetchedNotifs.sort((a, b) => {
        const t1 = a.createdAt?.seconds || 0;
        const t2 = b.createdAt?.seconds || 0;
        return t2 - t1;
      });

      setNotifications(fetchedNotifs);
    });

    return () => unsubNotifs();
  }, [currentUser.id, isFirebaseReady]);

  const handleMarkAsRead = async (notif: InAppNotification) => {
    try {
      await updateDoc(doc(db, 'notifications', notif.id), {
        isRead: true
      });
      
      // Navigate to chat
      if (notif.type === 'private_message') {
        const senderUser = allUsers.find(u => u.id === notif.chatId);
        if (senderUser) {
          setSelectedContact(senderUser);
          setIsSelectedDmActive(true);
          setSelectedGroup(null);
          setActiveMode('dms');
        } else if (currentUser.role !== 'admin') {
          setIsSelectedDmActive(true);
          setSelectedGroup(null);
          setActiveMode('dms');
        }
      } else {
        const targetGroup = groups.find(g => g.id === notif.chatId);
        if (targetGroup) {
          setSelectedGroup(targetGroup);
          setIsSelectedDmActive(false);
          setActiveMode('groups');
        }
      }
      setShowNotificationsDropdown(false);
    } catch (err) {
      console.warn("Could not mark notification as read:", err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      const unread = notifications.filter(n => !n.isRead);
      for (const notif of unread) {
        await updateDoc(doc(db, 'notifications', notif.id), {
          isRead: true
        });
      }
    } catch (err) {
      console.warn("Could not mark all notifications as read:", err);
    }
  };

  const handleClearAllNotifications = async () => {
    try {
      for (const notif of notifications) {
        await deleteDoc(doc(db, 'notifications', notif.id));
      }
    } catch (err) {
      console.warn("Could not clear notifications:", err);
    }
  };

  // Contacts & Presence State
  const [allUsers, setAllUsers] = useState<ChatUser[]>([]);
  const [currentUserProfile, setCurrentUserProfile] = useState<ChatUser | null>(null);

  // Edit Profile modal state
  const [showProfileModal, setShowProfileModal] = useState<boolean>(false);
  const [profileFullName, setProfileFullName] = useState<string>(currentUser.fullName);
  const [profileCountry, setProfileCountry] = useState<string>('IQ');
  const [profileImageFile, setProfileImageFile] = useState<File | null>(null);
  const [profileImagePreview, setProfileImagePreview] = useState<string>('');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState<boolean>(false);

  // Lightbox / Zoom modal
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  // Input states
  const [inputText, setInputText] = useState<string>('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);

  // Emoji Picker & Typing Indicator states
  const [showEmojiPicker, setShowEmojiPicker] = useState<boolean>(false);
  const [typingUsers, setTypingUsers] = useState<{ userId: string; userName: string }[]>([]);

  // Editing message state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState<string>('');

  // Joining group state
  const [manualInviteCode, setManualInviteCode] = useState<string>('');
  const [joinError, setJoinError] = useState<string>('');
  const [joinSuccess, setJoinSuccess] = useState<string>('');
  const [isJoining, setIsJoining] = useState<boolean>(false);
  const [showJoinModal, setShowJoinModal] = useState<boolean>(false);

  // Auto Scroll ref
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Emoji Categories Data
  const emojiCategories = {
    faces: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🫣', '🤭', '🫢', '🫡', '🤫', '🫠', '🤥', '😶', '🫥', '😐', '😑', '😬', '🫨', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '😵‍💫', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽', '👾', '🤖', '🎃'],
    gestures: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁️', '👅', '👄', '💋', '🩸'],
    hearts: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟'],
    symbols: ['🌟', '⭐', '✨', '⚡', '💥', '🔥', '🌈', '☀️', '🌤️', '⛅', '🌥️', '☁️', '🌦️', '🌧️', '⛈️', '🌩️', '🌨️', '❄️', '☃️', '⛄', '🌬️', '💨', '🌪️', '🌫️', '🌊', '💧', '💦', '🫧', '🎉', '🎁', '🎂', '🎈', '🎨', '🎬', '🎤', '🎧', '🎸', '🎮', '🎯', '⚽', '🏆', '🚗', '🚀', '📍', '💡', '⏰', '🔒', '🔑', '💬', '🔔']
  };

  const [emojiActiveTab, setEmojiActiveTab] = useState<'faces' | 'gestures' | 'hearts' | 'symbols'>('faces');

  // Typing status refs & functions
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isCurrentlyTypingRef = useRef<boolean>(false);

  // Update typing status in Firestore
  const updateTypingStatus = async (isTyping: boolean) => {
    if (!currentUser.id) return;
    const targetChatId = selectedGroup ? selectedGroup.id : isSelectedDmActive ? `admin_${currentUser.id}` : null;
    if (!targetChatId) return;

    const docId = `${targetChatId}_${currentUser.id}`;
    const typingRef = doc(db, 'typingStates', docId);

    try {
      if (isTyping) {
        await setDoc(typingRef, {
          id: docId,
          chatId: targetChatId,
          userId: currentUser.id,
          userName: currentUserProfile?.fullName || currentUser.fullName,
          isTyping: true,
          lastUpdated: new Date()
        }, { merge: true });
      } else {
        await deleteDoc(typingRef);
      }
    } catch (err) {
      console.warn("Failed to update typing status:", err);
    }
  };

  // Handle text input change and trigger typing indicator
  const handleInputChange = (val: string) => {
    setInputText(val);

    if (!isCurrentlyTypingRef.current) {
      isCurrentlyTypingRef.current = true;
      updateTypingStatus(true);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      isCurrentlyTypingRef.current = false;
      updateTypingStatus(false);
    }, 4000);
  };

  // Helper to insert emoji at cursor position
  const insertEmoji = (emoji: string) => {
    const isDm = isSelectedDmActive && !selectedGroup;
    const inputId = isDm ? 'dm-chat-text-input' : 'group-chat-text-input';
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (input) {
      const start = input.selectionStart ?? inputText.length;
      const end = input.selectionEnd ?? inputText.length;
      const text = inputText;
      const newText = text.substring(0, start) + emoji + text.substring(end);
      setInputText(newText);
      
      // Keep input focused and place cursor after inserted emoji
      setTimeout(() => {
        input.focus();
        const newCursorPos = start + emoji.length;
        input.setSelectionRange(newCursorPos, newCursorPos);
      }, 10);
    } else {
      setInputText(prev => prev + emoji);
    }
  };

  // 1. Presence System: Update current user's status to online in Firestore
  useEffect(() => {
    if (!isFirebaseReady) return;
    const userRef = doc(db, 'users', currentUser.id);
    
    // Set to online
    const setOnline = async () => {
      try {
        await updateDoc(userRef, {
          isOnline: true,
          lastActive: new Date()
        });
      } catch (err) {
        console.warn("Could not set user presence on load:", err);
      }
    };
    
    setOnline();

    // Heartbeat every 25 seconds
    const interval = setInterval(async () => {
      try {
        await updateDoc(userRef, {
          isOnline: true,
          lastActive: new Date()
        });
      } catch (err) {
        console.warn("Heartbeat update failed:", err);
      }
    }, 25000);

    // Set offline on cleanup (tab closing, logout, or unmount)
    return () => {
      clearInterval(interval);
      updateDoc(userRef, {
        isOnline: false,
        lastActive: new Date()
      }).catch((e) => console.warn("Failed to set offline:", e));
    };
  }, [currentUser.id, isFirebaseReady]);

  // 2. Fetch all users real-time to track status in Contacts tab
  useEffect(() => {
    if (!isFirebaseReady) return;
    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      const fetchedUsers: ChatUser[] = [];
      snapshot.forEach((doc) => {
        fetchedUsers.push(doc.data() as ChatUser);
      });
      setAllUsers(fetchedUsers);
    });

    return () => unsubUsers();
  }, [isFirebaseReady]);

  // 3. Keep current user's profile synced in real-time
  useEffect(() => {
    if (!isFirebaseReady) return;
    const unsubProfile = onSnapshot(doc(db, 'users', currentUser.id), (docSnap) => {
      if (docSnap.exists()) {
        const profile = docSnap.data() as ChatUser;
        setCurrentUserProfile(profile);
        setProfileFullName(profile.fullName);
        if (profile.country) {
          setProfileCountry(profile.country);
        }
        if (profile.photoUrl) {
          setProfileImagePreview(profile.photoUrl);
        }
      }
    });

    return () => unsubProfile();
  }, [currentUser.id, isFirebaseReady]);

  // 4. Mark private messages as read when viewing DMs (only for the active conversation)
  useEffect(() => {
    if (!isFirebaseReady) return;
    if (isSelectedDmActive) {
      const activeChatId = currentUser.role === 'admin' 
        ? `admin_${selectedContact?.id}` 
        : `admin_${currentUser.id}`;
      const unreadDms = privateMessages.filter(
        (m) => m.chatId === activeChatId && m.receiverId === currentUser.id && m.read !== true
      );
      if (unreadDms.length > 0) {
        unreadDms.forEach(async (msg) => {
          try {
            await updateDoc(doc(db, 'privateMessages', msg.id), { read: true });
          } catch (err) {
            console.error("Error marking DM as read:", err);
          }
        });
      }
    }
  }, [isSelectedDmActive, privateMessages, currentUser.id, currentUser.role, selectedContact?.id, isFirebaseReady]);

  // Listen for typing status in real-time
  useEffect(() => {
    if (!isFirebaseReady) return;
    const activeChatId = selectedGroup ? selectedGroup.id : isSelectedDmActive ? `admin_${currentUser.id}` : null;
    if (!activeChatId) {
      setTypingUsers([]);
      return;
    }

    const q = query(
      collection(db, 'typingStates'),
      where('chatId', '==', activeChatId),
      where('userId', '!=', currentUser.id)
    );

    const unsubTyping = onSnapshot(q, (snapshot) => {
      const users: { userId: string; userName: string }[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        const lastUpdated = data.lastUpdated?.toDate ? data.lastUpdated.toDate() : new Date(data.lastUpdated);
        // Stale check (15 seconds)
        if (Date.now() - lastUpdated.getTime() < 15000) {
          users.push({
            userId: data.userId,
            userName: data.userName
          });
        }
      });
      setTypingUsers(users);
    });

    return () => {
      unsubTyping();
      if (isCurrentlyTypingRef.current) {
        isCurrentlyTypingRef.current = false;
        updateTypingStatus(false).catch((e) => console.warn(e));
      }
    };
  }, [selectedGroup?.id, isSelectedDmActive, currentUser.id, isFirebaseReady]);

  const isUserOnline = (user: ChatUser) => {
    if (user.isOnline === false) return false;
    if (!user.lastActive) return false;
    const lastActiveTime = user.lastActive.seconds
      ? user.lastActive.seconds * 1000
      : new Date(user.lastActive).getTime();
    const ninetySecondsAgo = Date.now() - 90 * 1000;
    return lastActiveTime > ninetySecondsAgo;
  };

  const formatMessageTimestamp = (createdAt: any) => {
    if (!createdAt) return '';
    const date = createdAt.toDate ? createdAt.toDate() : new Date(createdAt.seconds * 1000 || createdAt);
    return `${date.toLocaleDateString('ar-IQ', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    })} - ${date.toLocaleTimeString('ar-IQ', {
      hour: '2-digit',
      minute: '2-digit'
    })}`;
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileFullName.trim()) return;

    setIsUpdatingProfile(true);
    let finalPhotoUrl = currentUserProfile?.photoUrl || '';

    try {
      if (profileImageFile) {
        try {
          const storageRef = ref(storage, `profiles/${currentUser.id}`);
          const snapshot = await uploadBytesWithTimeout(storageRef, profileImageFile, 2500);
          finalPhotoUrl = await getDownloadURL(snapshot.ref);
        } catch (storageErr) {
          console.warn('Firebase Storage upload failed, compressing and using local Base64:', storageErr);
          const compressedBase64 = await compressImageToBase64(profileImageFile);
          finalPhotoUrl = compressedBase64 || profileImagePreview; // Fallback to compressed base64
        }
      }

      // Update in Firestore
      const userRef = doc(db, 'users', currentUser.id);
      await updateDoc(userRef, {
        fullName: profileFullName.trim(),
        photoUrl: finalPhotoUrl,
        country: profileCountry
      });

      // Update localStorage session to keep sync
      const savedSession = localStorage.getItem('chat_platform_session');
      if (savedSession) {
        const session = JSON.parse(savedSession);
        session.fullName = profileFullName.trim();
        localStorage.setItem('chat_platform_session', JSON.stringify(session));
      }

      alert('تم تحديث الملف الشخصي بنجاح!');
      setShowProfileModal(false);
      setProfileImageFile(null);
    } catch (err: any) {
      console.error('Error updating profile:', err);
      alert(`فشل تحديث الملف الشخصي: ${err.message}`);
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  // Listen for user group memberships
  useEffect(() => {
    if (!isFirebaseReady) return;
    const q = query(collection(db, 'groupMembers'), where('userId', '==', currentUser.id));
    const unsubMemberships = onSnapshot(q, (snapshot) => {
      const gIds: string[] = [];
      snapshot.forEach((doc) => {
        gIds.push(doc.data().groupId);
      });
      setUserMemberships(gIds);
    });

    return () => unsubMemberships();
  }, [currentUser.id, isFirebaseReady]);

  // Listen for all groups
  useEffect(() => {
    if (!isFirebaseReady) return;
    const unsubGroups = onSnapshot(collection(db, 'groups'), (snapshot) => {
      const fetchedGroups: ChatGroup[] = [];
      snapshot.forEach((doc) => {
        fetchedGroups.push(doc.data() as ChatGroup);
      });
      setGroups(fetchedGroups);
    });

    return () => unsubGroups();
  }, [isFirebaseReady]);

  // Handle URL Invite Code automatically on mount
  useEffect(() => {
    if (initialInviteCode && userMemberships.length > 0) {
      handleJoinGroupWithCode(initialInviteCode);
    }
  }, [initialInviteCode, userMemberships.length]);

  // Listen for messages inside the active group
  useEffect(() => {
    if (!isFirebaseReady) return;
    if (!selectedGroup) {
      setMessages([]);
      return;
    }

    const q = query(
      collection(db, 'messages'),
      where('groupId', '==', selectedGroup.id)
    );

    const unsubMsgs = onSnapshot(q, (snapshot) => {
      const fetchedMsgs: GroupMessage[] = [];
      snapshot.forEach((doc) => {
        fetchedMsgs.push(doc.data() as GroupMessage);
      });

      // Sort messages client-side by time
      fetchedMsgs.sort((a, b) => {
        const t1 = a.createdAt?.seconds || 0;
        const t2 = b.createdAt?.seconds || 0;
        return t1 - t2;
      });

      setMessages(fetchedMsgs);
      // Scroll to bottom
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    });

    return () => unsubMsgs();
  }, [selectedGroup, isFirebaseReady]);

  // Listen for private DMs with admin (Admin listens globally, User listens to their own chat only)
  useEffect(() => {
    if (!isFirebaseReady) return;
    let q;
    if (currentUser.role === 'admin') {
      q = query(collection(db, 'privateMessages'));
    } else {
      const chatId = `admin_${currentUser.id}`;
      q = query(
        collection(db, 'privateMessages'),
        where('chatId', '==', chatId)
      );
    }

    const unsubDms = onSnapshot(q, (snapshot) => {
      const fetchedDms: PrivateMessage[] = [];
      snapshot.forEach((doc) => {
        fetchedDms.push(doc.data() as PrivateMessage);
      });

      // Sort client side
      fetchedDms.sort((a, b) => {
        const t1 = a.createdAt?.seconds || 0;
        const t2 = b.createdAt?.seconds || 0;
        return t1 - t2;
      });

      setPrivateMessages(fetchedDms);
      // Scroll to bottom
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    });

    return () => unsubDms();
  }, [currentUser.id, currentUser.role, isFirebaseReady]);

  // Trigger scroll to bottom on screen changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedGroup, isSelectedDmActive]);

  // Join group with a code function
  const handleJoinGroupWithCode = async (code: string) => {
    if (!code.trim()) return;
    setIsJoining(true);
    setJoinError('');
    setJoinSuccess('');

    try {
      const uCode = code.trim().toUpperCase();

      // Find group with this invite code
      const groupQuery = query(collection(db, 'groups'), where('inviteCode', '==', uCode));
      const groupSnapshot = await getDocs(groupQuery);

      if (groupSnapshot.empty) {
        setJoinError('رمز الدعوة غير صحيح أو منتهي الصلاحية');
        setIsJoining(false);
        return;
      }

      const groupDoc = groupSnapshot.docs[0];
      const groupData = groupDoc.data() as ChatGroup;

      // Check if user is already a member
      if (userMemberships.includes(groupData.id)) {
        setJoinSuccess(`أنت عضو بالفعل في مجموعة "${groupData.name}"`);
        setSelectedGroup(groupData);
        setActiveMode('groups');
        setIsSelectedDmActive(false);
        setIsJoining(false);
        setTimeout(() => {
          setShowJoinModal(false);
          setJoinSuccess('');
        }, 1500);
        return;
      }

      // Add user to membership collection
      const memberId = `${groupData.id}_${currentUser.id}`;
      const memberRef = doc(db, 'groupMembers', memberId);

      await setDoc(memberRef, {
        id: memberId,
        groupId: groupData.id,
        userId: currentUser.id,
        joinedAt: new Date()
      });

      setJoinSuccess(`تم الانضمام بنجاح لمجموعة "${groupData.name}"! 🎉`);
      setSelectedGroup(groupData);
      setActiveMode('groups');
      setIsSelectedDmActive(false);

      setTimeout(() => {
        setShowJoinModal(false);
        setJoinSuccess('');
        setManualInviteCode('');
      }, 1500);

    } catch (err: any) {
      console.error('Error joining group:', err);
      setJoinError(`فشل الانضمام للكروب: ${err.message || 'خطأ غير معروف'}`);
    } finally {
      setIsJoining(false);
    }
  };

  // Image select helper
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImageFile(file);

      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Send group message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup) return;
    if (!inputText.trim() && !imageFile) return;

    // Immediately clear typing state
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    isCurrentlyTypingRef.current = false;
    updateTypingStatus(false).catch((err) => console.warn(err));

    setIsSending(true);
    const messageId = `msg_${Math.random().toString(36).substring(2, 11)}`;
    let finalPhotoUrl = '';

    try {
      // 1. Upload file if exists with compressed fallback and timeout
      if (imageFile) {
        try {
          const compressedBase64 = await compressImageToBase64(imageFile);
          try {
            const storageRef = ref(storage, `messages/${messageId}`);
            const snapshot = await uploadBytesWithTimeout(storageRef, imageFile, 2500);
            finalPhotoUrl = await getDownloadURL(snapshot.ref);
          } catch (storageErr) {
            console.warn('Firebase Storage failed or timed out, saving photo as compressed Base64:', storageErr);
            finalPhotoUrl = compressedBase64 || imagePreview; // Save the compressed base64 string directly
          }
        } catch (compressErr) {
          console.error('Error compressing image:', compressErr);
          finalPhotoUrl = imagePreview;
        }
      }

      // 2. Post to Firestore
      const msgRef = doc(db, 'messages', messageId);
      const msgData: GroupMessage = {
        id: messageId,
        groupId: selectedGroup.id,
        senderId: currentUser.id,
        senderName: currentUser.fullName,
        senderUsername: currentUser.username,
        text: inputText.trim(),
        createdAt: new Date()
      };

      if (finalPhotoUrl) {
        msgData.photoUrl = finalPhotoUrl;
      }

      await setDoc(msgRef, msgData);

      // Create in-app notifications for mentioned users and group members
      const textToScan = inputText.trim();
      if (textToScan) {
        const mentions = textToScan.match(/@\w+/g) || [];
        const mentionedUsernames = mentions.map(m => m.substring(1));
        const mentionedUsers = allUsers.filter(u => mentionedUsernames.includes(u.username) && u.id !== currentUser.id);

        // 1. Notify mentioned users
        for (const mentionedUser of mentionedUsers) {
          await createNotification(
            mentionedUser.id,
            "منشن جديد 🔔",
            `قام @${currentUser.username} بذكرك في الكروب "${selectedGroup.name}": "${textToScan.substring(0, 40)}${textToScan.length > 40 ? '...' : ''}"`,
            'mention',
            selectedGroup.id
          );
        }

        // 2. Notify other group members of a new message (who are not the sender and not mentioned)
        try {
          const membersSnap = await getDocs(query(collection(db, 'groupMembers'), where('groupId', '==', selectedGroup.id)));
          const memberUserIds: string[] = [];
          membersSnap.forEach((memberDoc) => {
            const uid = memberDoc.data().userId;
            if (uid !== currentUser.id && !mentionedUsers.some(mu => mu.id === uid)) {
              memberUserIds.push(uid);
            }
          });
          
          for (const uid of memberUserIds) {
            await createNotification(
              uid,
              "رسالة جديدة 💬",
              `رسالة جديدة من @${currentUser.username} في كروب "${selectedGroup.name}"`,
              'new_message',
              selectedGroup.id
            );
          }
        } catch (memberErr) {
          console.warn("Could not send group message notifications:", memberErr);
        }
      }

      // Clean inputs
      setInputText('');
      setImageFile(null);
      setImagePreview('');

    } catch (err: any) {
      console.error('Error sending message:', err);
      alert(`فشل إرسال الرسالة: ${err.message}`);
    } finally {
      setIsSending(false);
    }
  };

  // Send reply private DM to admin or selected contact
  const handleSendPrivateMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    // Immediately clear typing state
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    isCurrentlyTypingRef.current = false;
    updateTypingStatus(false).catch((err) => console.warn(err));

    setIsSending(true);
    const messageId = `pmsg_${Math.random().toString(36).substring(2, 11)}`;

    const targetUserId = currentUser.role === 'admin'
      ? (selectedContact?.id || '')
      : currentUser.id;

    if (!targetUserId) {
      setIsSending(false);
      return;
    }

    const chatId = `admin_${targetUserId}`;

    try {
      const pmRef = doc(db, 'privateMessages', messageId);
      await setDoc(pmRef, {
        id: messageId,
        chatId: chatId,
        senderId: currentUser.id,
        receiverId: currentUser.role === 'admin' ? targetUserId : 'admin_root',
        text: inputText.trim(),
        createdAt: new Date(),
        read: false
      });

      // Send private message notification
      if (currentUser.role === 'admin') {
        await createNotification(
          targetUserId,
          "رسالة خاصة جديدة 💬",
          `أرسل لك المدير رسالة خاصة: "${inputText.trim().substring(0, 40)}${inputText.trim().length > 40 ? '...' : ''}"`,
          'private_message',
          currentUser.id
        );
      } else {
        const admins = allUsers.filter(u => u.role === 'admin');
        for (const admin of admins) {
          await createNotification(
            admin.id,
            "رسالة خاصة جديدة 💬",
            `أرسل لك العضو @${currentUser.username} رسالة خاصة: "${inputText.trim().substring(0, 40)}${inputText.trim().length > 40 ? '...' : ''}"`,
            'private_message',
            currentUser.id
          );
        }
      }

      setInputText('');
    } catch (err: any) {
      console.error('Error sending DM:', err);
    } finally {
      setIsSending(false);
    }
  };

  // Edit own message
  const handleStartEdit = (msg: GroupMessage) => {
    setEditingMessageId(msg.id);
    setEditText(msg.text);
  };

  const handleSaveEdit = async (msgId: string) => {
    if (!editText.trim()) return;
    try {
      const msgRef = doc(db, 'messages', msgId);
      await updateDoc(msgRef, {
        text: editText.trim(),
        editedAt: new Date()
      });
      setEditingMessageId(null);
    } catch (err: any) {
      console.error('Error editing message:', err);
    }
  };

  // Delete own message (or admin deleting any message)
  const handleDeleteMessage = async (msgId: string) => {
    if (!window.confirm('هل تريد بالتأكيد حذف هذه الرسالة؟')) return;
    try {
      const msgRef = doc(db, 'messages', msgId);
      await deleteDoc(msgRef);
    } catch (err: any) {
      console.error('Error deleting message:', err);
    }
  };

  // Copy current group invite link helper
  const copyGroupInviteCode = (code: string) => {
    const inviteLink = `${window.location.origin}${window.location.pathname}?invite=${code}`;
    navigator.clipboard.writeText(inviteLink).then(() => {
      alert('تم نسخ رابط الدعوة! يمكنك مشاركته لينضم أصدقاؤك فوراً.');
    });
  };

  return (
    <div className="w-full h-screen bg-zinc-950 text-white font-sans flex flex-col md:flex-row-reverse" dir={t('dir')} id="chat-stage-layout">
      
      {/* Sidebar (List of Groups & Private Chats) */}
      <div className="w-full md:w-80 bg-zinc-900 border-b md:border-b-0 md:border-l border-zinc-800 flex flex-col h-[40vh] md:h-screen shrink-0" id="chat-sidebar">
        {/* User Profile Header */}
        <div className="p-4 bg-zinc-950/80 border-b border-zinc-800 flex items-center justify-between relative" id="chat-user-header">
          <button
            onClick={() => setShowProfileModal(true)}
            className="flex items-center gap-2.5 text-right hover:opacity-80 transition-opacity cursor-pointer group flex-1 min-w-0"
            title="تعديل الملف الشخصي"
          >
            {currentUserProfile?.photoUrl ? (
              <img
                src={currentUserProfile.photoUrl}
                alt="Avatar"
                referrerPolicy="no-referrer"
                className="w-9 h-9 rounded-full object-cover border border-zinc-700 group-hover:border-emerald-500 transition-colors"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-emerald-600 flex items-center justify-center font-bold text-sm text-white group-hover:bg-emerald-500 transition-colors">
                {currentUserProfile?.fullName ? currentUserProfile.fullName.substring(0, 1) : currentUser.fullName.substring(0, 1)}
              </div>
            )}
            <div className="text-right flex-1 min-w-0">
              <h4 className="font-bold text-xs text-white leading-tight truncate flex items-center gap-1">
                {currentUserProfile?.fullName || currentUser.fullName} <span className="text-sm select-none">{getCurrentUserFlag()}</span>
              </h4>
              <span className="text-[10px] text-zinc-500 font-mono block">@{currentUser.username}</span>
            </div>
          </button>

          <div className="flex items-center gap-1.5 shrink-0 relative">
            {/* Language Switcher Button */}
            <div className="relative shrink-0">
              <button
                type="button"
                id="btn-switch-language"
                onClick={() => setShowLangMenu(!showLangMenu)}
                className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center transition-colors cursor-pointer relative"
                title="تغيير لغة الموقع / Change Language"
              >
                <Globe size={14} className={showLangMenu ? "text-emerald-400" : ""} />
              </button>
              <AnimatePresence>
                {showLangMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowLangMenu(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute top-10 left-0 mt-1 w-48 bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl z-50 py-1.5 max-h-64 overflow-y-auto"
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

            {/* Bell Button */}
            <button
              id="btn-user-notifications"
              onClick={() => setShowNotificationsDropdown(!showNotificationsDropdown)}
              className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center transition-colors cursor-pointer relative"
              title="الإشعارات"
            >
              <Bell size={14} className={notifications.some(n => !n.isRead) ? "animate-bounce text-emerald-400" : ""} />
              {notifications.some(n => !n.isRead) && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center border border-zinc-950 animate-pulse">
                  {notifications.filter(n => !n.isRead).length}
                </span>
              )}
            </button>

            {/* Logout Button */}
            <button
              id="btn-user-logout"
              onClick={onLogout}
              className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-red-950/40 text-zinc-400 hover:text-red-400 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              title="تسجيل الخروج"
            >
              <LogOut size={14} />
            </button>
          </div>

          {/* Notifications Dropdown */}
          <AnimatePresence>
            {showNotificationsDropdown && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute left-4 top-16 w-72 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl z-50 overflow-hidden flex flex-col max-h-[350px]"
                id="notifications-dropdown-menu"
              >
                {/* Dropdown Header */}
                <div className="p-3 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between">
                  <span className="text-xs font-bold text-white">الإشعارات ({notifications.filter(n => !n.isRead).length})</span>
                  <div className="flex gap-2">
                    {notifications.length > 0 && (
                      <button
                        onClick={handleMarkAllAsRead}
                        className="text-[10px] text-emerald-400 hover:underline cursor-pointer"
                      >
                        تحديد الكل مقروء
                      </button>
                    )}
                    {notifications.length > 0 && (
                      <button
                        onClick={handleClearAllNotifications}
                        className="text-[10px] text-zinc-500 hover:text-red-400 cursor-pointer"
                      >
                        مسح الكل
                      </button>
                    )}
                  </div>
                </div>

                {/* Dropdown Body / List */}
                <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/60 max-h-[250px] scrollbar-thin">
                  {notifications.length === 0 ? (
                    <div className="p-6 text-center text-zinc-500 text-xs flex flex-col items-center gap-2">
                      <Bell size={24} className="text-zinc-700" />
                      <span>لا توجد إشعارات حالياً</span>
                    </div>
                  ) : (
                    notifications.map((notif) => (
                      <div
                        key={notif.id}
                        onClick={() => handleMarkAsRead(notif)}
                        className={`p-3 text-right text-xs transition-colors cursor-pointer hover:bg-zinc-800 flex flex-col gap-1 ${
                          notif.isRead ? 'opacity-60 bg-transparent' : 'bg-emerald-600/5'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white flex items-center gap-1">
                            {!notif.isRead && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />}
                            {notif.title}
                          </span>
                          <span className="text-[9px] text-zinc-500 font-mono">
                            {notif.createdAt?.seconds ? new Date(notif.createdAt.seconds * 1000).toLocaleTimeString('ar-EG', {hour: '2-digit', minute:'2-digit'}) : 'الآن'}
                          </span>
                        </div>
                        <p className="text-zinc-300 text-[11px] leading-relaxed line-clamp-2">{notif.body}</p>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation Tabs (Groups vs Contacts vs DMs) */}
        <div className="flex p-2 bg-zinc-950 border-b border-zinc-800 gap-1" id="chat-nav-tabs">
          <button
            id="chat-tab-groups"
            onClick={() => {
              setActiveMode('groups');
              setIsSelectedDmActive(false);
            }}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
              activeMode === 'groups' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Users size={14} />
            الكروبات
          </button>

          <button
            id="chat-tab-contacts"
            onClick={() => {
              setActiveMode('contacts');
              setIsSelectedDmActive(false);
            }}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
              activeMode === 'contacts' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <UserCheck size={14} />
            الأعضاء
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping inline-block shrink-0" />
          </button>

          <button
            id="chat-tab-dms"
            onClick={() => {
              setActiveMode('dms');
              setIsSelectedDmActive(true);
              setSelectedGroup(null);
            }}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors relative ${
              activeMode === 'dms' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <MessageSquare size={14} />
            الدعم
            {unreadCount > 0 && (
              <span className="absolute -top-1 -left-1 bg-red-500 text-white text-[9px] font-bold h-4 min-w-4 px-1 rounded-full flex items-center justify-center animate-bounce shadow-md">
                {unreadCount}
              </span>
            )}
          </button>
        </div>

        {/* Content Lists */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3" id="chat-items-container">
          {activeMode === 'groups' ? (
            /* Groups View */
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1 mb-2">
                <span className="text-[10px] text-zinc-500 font-bold uppercase">الكروبات المنضم لها</span>
                <button
                  id="btn-open-join-modal"
                  onClick={() => setShowJoinModal(true)}
                  className="p-1 hover:bg-zinc-800 text-emerald-400 rounded-md flex items-center gap-1 text-xs cursor-pointer font-semibold"
                >
                  <Plus size={14} />
                  انضمام لكروب
                </button>
              </div>

              {groups.filter((g) => currentUser.role === 'admin' || userMemberships.includes(g.id)).length === 0 ? (
                <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl text-center space-y-3">
                  <p className="text-[11px] text-zinc-500 leading-relaxed">أنت لست منضماً لأي كروب حالياً. يرجى طلب رابط دعوة من مالك المنصة.</p>
                  <button
                    id="btn-join-first-group"
                    onClick={() => setShowJoinModal(true)}
                    className="w-full py-1.5 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white transition-colors rounded-lg text-[11px] font-bold"
                  >
                    أدخل كود الدعوة للانضمام
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5" id="user-joined-groups-list">
                  {groups
                    .filter((g) => currentUser.role === 'admin' || userMemberships.includes(g.id))
                    .map((group) => (
                      <button
                        id={`btn-select-group-${group.id}`}
                        key={group.id}
                        onClick={() => {
                          setSelectedGroup(group);
                          setIsSelectedDmActive(false);
                        }}
                        className={`w-full p-2.5 rounded-xl text-right transition-all flex items-center gap-3 border ${
                          selectedGroup?.id === group.id
                            ? 'bg-emerald-600/15 border-emerald-500/50'
                            : 'bg-zinc-950 hover:bg-zinc-800/80 border-transparent'
                        }`}
                      >
                        <img
                          src={group.photoUrl || `https://api.dicebear.com/7.x/identicon/svg?seed=${group.id}`}
                          alt={group.name}
                          className="w-10 h-10 rounded-xl object-cover border border-zinc-800 bg-zinc-900"
                        />
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-xs text-white truncate text-right">{group.name}</h4>
                          <p className="text-[10px] text-zinc-500 truncate text-right mt-0.5">{group.description || 'بدون وصف'}</p>
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </div>
          ) : activeMode === 'contacts' ? (
            /* Contacts View (Online/Offline list) */
            <div className="space-y-2">
              <span className="text-[10px] text-zinc-500 font-bold uppercase px-1 block mb-2">قائمة جهات الاتصال (الأعضاء)</span>
              
              <div className="space-y-1.5" id="contacts-list">
                {allUsers
                  .filter((u) => u.id !== currentUser.id) // Hide self
                  .map((user) => {
                    const online = isUserOnline(user);
                    return (
                      <div
                        key={user.id}
                        id={`contact-user-${user.id}`}
                        className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/80 flex items-center justify-between text-right"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {user.photoUrl ? (
                            <img
                              src={user.photoUrl}
                              alt={user.fullName}
                              className="w-9 h-9 rounded-full object-cover border border-zinc-800 shrink-0"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-zinc-850 flex items-center justify-center font-bold text-xs text-zinc-400 shrink-0 border border-zinc-700">
                              {(user.fullName || 'أ').substring(0, 1)}
                            </div>
                          )}
                          <div className="min-w-0 text-right">
                            <span className="text-xs font-bold block text-white truncate flex items-center gap-1">
                              {user.fullName} <span className="text-sm select-none">{getUserFlag(user.id)}</span>
                            </span>
                            <span className="text-[10px] text-zinc-500 font-mono block">@{user.username}</span>
                          </div>
                        </div>

                        {/* Presence status & Action Button */}
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="flex items-center gap-1">
                            <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50 animate-pulse' : 'bg-zinc-600'}`} />
                            <span className={`text-[10px] font-bold ${online ? 'text-emerald-400' : 'text-zinc-500'}`}>
                              {online ? 'متصل' : 'غير متصل'}
                            </span>
                          </div>

                          {currentUser.role === 'admin' && (
                            <button
                              id={`btn-message-contact-${user.id}`}
                              onClick={() => {
                                setSelectedContact(user);
                                setIsSelectedDmActive(true);
                                setSelectedGroup(null);
                                setActiveMode('dms');
                              }}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-bold transition-colors cursor-pointer"
                            >
                              مراسلة
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          ) : (
            /* Private DMs View */
            <div className="space-y-2">
              <span className="text-[10px] text-zinc-500 font-bold uppercase px-1 block mb-2">
                {currentUser.role === 'admin' ? 'مراسلة الأعضاء' : 'الدعم والمدير'}
              </span>
              {currentUser.role === 'admin' ? (
                <div className="space-y-1.5" id="admin-dm-users-list">
                  {allUsers
                    .filter((u) => u.id !== currentUser.id)
                    .map((user) => {
                      const online = isUserOnline(user);
                      return (
                        <button
                          id={`btn-admin-dm-user-${user.id}`}
                          key={user.id}
                          onClick={() => {
                            setSelectedContact(user);
                            setIsSelectedDmActive(true);
                            setSelectedGroup(null);
                          }}
                          className={`w-full p-2.5 rounded-xl text-right transition-all flex items-center justify-between border ${
                            isSelectedDmActive && selectedContact?.id === user.id
                              ? 'bg-emerald-600/15 border-emerald-500/50'
                              : 'bg-zinc-950 hover:bg-zinc-800/80 border-transparent'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-300 border border-zinc-700 overflow-hidden shrink-0 relative">
                              {user.photoUrl ? (
                                <img src={user.photoUrl} alt="" className="w-full h-full object-cover" />
                              ) : (
                                (user.fullName || 'أ').substring(0, 1)
                              )}
                              <span className={`absolute bottom-0 right-0 w-2 h-2 rounded-full border border-zinc-900 ${online ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50' : 'bg-zinc-600'}`} />
                            </div>
                            <div className="min-w-0 text-right">
                              <span className="text-xs font-bold block text-white truncate text-right flex items-center gap-1">
                                {user.fullName} <span className="text-sm select-none">{getUserFlag(user.id)}</span>
                              </span>
                              <span className="text-[10px] text-zinc-500 font-mono block text-right">@{user.username}</span>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2 shrink-0">
                            {getUserUnreadDmCount(user.id) > 0 && (
                              <span className="bg-red-500 text-white text-[9px] font-bold h-4 min-w-4 px-1.5 rounded-full flex items-center justify-center animate-bounce shadow-md">
                                {getUserUnreadDmCount(user.id)}
                              </span>
                            )}
                            <span className={`text-[9px] font-bold ${online ? 'text-emerald-400' : 'text-zinc-500'}`}>
                              {online ? 'متصل' : 'غير متصل'}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                </div>
              ) : (
                <button
                  id="btn-select-admin-dm"
                  onClick={() => {
                    setIsSelectedDmActive(true);
                    setSelectedGroup(null);
                  }}
                  className={`w-full p-3 rounded-xl text-right transition-all flex items-center gap-3 border relative ${
                    isSelectedDmActive && !selectedGroup
                      ? 'bg-emerald-600/15 border-emerald-500/50'
                      : 'bg-zinc-950 hover:bg-zinc-800/80 border-transparent'
                  }`}
                >
                  <div className="w-9 h-9 rounded-full bg-emerald-600/20 text-emerald-400 border border-emerald-500/20 flex items-center justify-center font-mono font-bold text-xs shrink-0">
                    A
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-xs text-white text-right">محادثة المالك (Admin)</h4>
                    <p className="text-[10px] text-emerald-400 text-right mt-0.5">خط مراسلة آمن ومباشر</p>
                  </div>
                  {unreadCount > 0 && (
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 bg-red-500 text-white text-[9px] font-bold h-4 min-w-4 px-1.5 rounded-full flex items-center justify-center animate-bounce shadow-md">
                      {unreadCount}
                    </span>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Feed Area */}
      <div className="flex-1 bg-zinc-900 flex flex-col h-[60vh] md:h-screen overflow-hidden" id="chat-feed-stage">
        {selectedGroup ? (
          /* Active Group Chat Room */
          <>
            {/* Header */}
            <div className="p-4 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between" id="group-chat-header">
              <div className="flex items-center gap-3">
                <img
                  src={selectedGroup.photoUrl || `https://api.dicebear.com/7.x/identicon/svg?seed=${selectedGroup.id}`}
                  alt={selectedGroup.name}
                  className="w-10 h-10 rounded-xl object-cover border border-zinc-800 bg-zinc-900"
                />
                <div className="text-right">
                  <h3 className="font-bold text-sm text-white">{selectedGroup.name}</h3>
                  <p className="text-[10px] text-zinc-400 line-clamp-1 mt-0.5">{selectedGroup.description || 'أهلاً بكم في دردشة المجموعة'}</p>
                </div>
              </div>

              {/* Share invite link button */}
              <button
                id="btn-copy-header-invite"
                onClick={() => copyGroupInviteCode(selectedGroup.inviteCode)}
                className="h-8 px-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer"
              >
                <Link size={12} />
                رابط الدعوة
              </button>
            </div>

            {/* Messages Feed */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4 flex flex-col" id="group-message-log">
              {messages.length === 0 ? (
                <div className="my-auto text-center space-y-2 text-zinc-500 text-xs">
                  <MessageCircle className="mx-auto text-zinc-600 animate-bounce" size={32} />
                  <p>لا توجد رسائل في هذا الكروب بعد.</p>
                  <p className="text-[10px]">اكتب رسالة بالأسفل وشارك المحادثة مع أصدقائك!</p>
                </div>
              ) : (
                messages.map((msg) => {
                  const isOwn = msg.senderId === currentUser.id;
                  const isEditing = editingMessageId === msg.id;

                  return (
                    <div
                      key={msg.id}
                      className={`flex gap-2.5 max-w-[85%] items-end ${
                        isOwn ? 'self-start flex-row-reverse' : 'self-end flex-row'
                      }`}
                    >
                      {/* Sender Avatar */}
                      {!isOwn && (
                        <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-300 border border-zinc-700 overflow-hidden shrink-0">
                          {allUsers.find((u) => u.id === msg.senderId)?.photoUrl ? (
                            <img
                              src={allUsers.find((u) => u.id === msg.senderId)!.photoUrl}
                              alt={msg.senderName}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            msg.senderName.substring(0, 1)
                          )}
                        </div>
                      )}
                      
                      {isOwn && (
                        <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-xs font-bold text-white overflow-hidden shrink-0">
                          {currentUserProfile?.photoUrl ? (
                            <img
                              src={currentUserProfile.photoUrl}
                              alt="Me"
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            currentUser.fullName.substring(0, 1)
                          )}
                        </div>
                      )}

                      <div className={`flex flex-col ${isOwn ? 'items-start' : 'items-end'}`}>
                        {/* Sender Info */}
                        <span className="text-[10px] text-zinc-400 mb-1 font-sans px-1 flex items-center gap-1">
                          {isOwn ? (
                            <>أنت <span className="text-xs select-none">{getCurrentUserFlag()}</span></>
                          ) : (
                            <>{msg.senderName} <span className="text-xs select-none">{getUserFlag(msg.senderId)}</span></>
                          )}
                          <span className="text-zinc-600 font-mono text-[9px]">@{msg.senderUsername}</span>
                        </span>

                        {/* Bubble content */}
                        <div
                          className={`p-3.5 rounded-2xl text-xs text-right leading-relaxed border flex flex-col gap-2 ${
                            isOwn
                              ? 'bg-emerald-600 text-white border-emerald-500/30 rounded-br-none'
                              : 'bg-zinc-950 text-zinc-100 border-zinc-800 rounded-bl-none'
                          }`}
                        >
                          {/* If has image, render it */}
                          {msg.photoUrl && (
                            <div
                              onClick={() => setZoomedImage(msg.photoUrl || null)}
                              className="rounded-xl overflow-hidden max-w-xs border border-zinc-800 max-h-60 cursor-zoom-in group relative"
                            >
                              <img src={msg.photoUrl} alt="Upload" className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <span className="text-[10px] bg-black/60 px-2 py-1 rounded text-white font-medium">تكبير الصورة 🔍</span>
                              </div>
                            </div>
                          )}

                          {/* Text rendering or edit box */}
                          {isEditing ? (
                            <div className="flex flex-col gap-1.5 min-w-[200px]">
                              <input
                                id={`edit-input-${msg.id}`}
                                type="text"
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                className="w-full p-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs focus:outline-none"
                              />
                              <div className="flex gap-1 justify-end">
                                <button
                                  id={`btn-save-edit-${msg.id}`}
                                  onClick={() => handleSaveEdit(msg.id)}
                                  className="p-1 bg-emerald-500 text-white rounded hover:bg-emerald-400"
                                >
                                  <Check size={12} />
                                </button>
                                <button
                                  id={`btn-cancel-edit-${msg.id}`}
                                  onClick={() => setEditingMessageId(null)}
                                  className="p-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap">{msg.text}</p>
                          )}
                        </div>

                        {/* Actions and Timestamp */}
                        <div className="flex items-center gap-1.5 mt-1 px-1">
                          <span className="text-[8px] text-zinc-500">
                            {msg.createdAt?.seconds ? formatMessageTimestamp(msg.createdAt) : ''}
                            {msg.editedAt && ' (معدلة)'}
                          </span>

                        {/* Only allow own user to edit/delete, or admin to delete everything */}
                        {!isEditing && isOwn && (
                          <div className="flex items-center gap-1">
                            <button
                              id={`btn-start-edit-${msg.id}`}
                              onClick={() => handleStartEdit(msg)}
                              className="text-zinc-600 hover:text-emerald-400 p-0.5"
                              title="تعديل الرسالة"
                            >
                              <Edit2 size={10} />
                            </button>
                            <button
                              id={`btn-delete-msg-${msg.id}`}
                              onClick={() => handleDeleteMessage(msg.id)}
                              className="text-zinc-600 hover:text-red-400 p-0.5"
                              title="حذف الرسالة"
                            >
                              <Trash2 size={10} />
                            </button>
                          </div>
                        )}

                        {/* Admin delete bypass */}
                        {!isOwn && currentUser.role === 'admin' && (
                          <button
                            id={`btn-admin-delete-msg-${msg.id}`}
                            onClick={() => handleDeleteMessage(msg.id)}
                            className="text-zinc-600 hover:text-red-400 p-0.5"
                            title="حذف الرسالة (صلاحية المدير)"
                          >
                            <Trash2 size={10} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Realtime Typing Indicator */}
            {typingUsers.length > 0 && (
              <div className="px-4 py-2 bg-zinc-950/90 border-t border-zinc-900 flex items-center justify-end gap-2 shrink-0" id="typing-indicator-bar">
                <span className="text-[10px] text-zinc-400 font-sans">
                  {typingUsers.map(u => u.userName).join('، ')} {typingUsers.length === 1 ? 'يكتب الآن...' : 'يكتبون الآن...'}
                </span>
                <div className="flex gap-0.5 items-center justify-center h-2" id="typing-bubble-dots">
                  <span className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}

            {/* Image Preview bar if selected */}
            {imagePreview && (
              <div className="p-3 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between" id="image-upload-preview-bar">
                <div className="flex items-center gap-3">
                  <div className="w-16 h-16 rounded-lg overflow-hidden border border-zinc-700">
                    <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-zinc-300 block">صورة جاهزة للإرسال</span>
                    <span className="text-[10px] text-zinc-500">سيتم رفعها وتضمينها مع الرسالة</span>
                  </div>
                </div>
                <button
                  id="btn-remove-image-preview"
                  onClick={() => {
                    setImageFile(null);
                    setImagePreview('');
                  }}
                  className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 flex items-center justify-center cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {/* Input Bar Wrapper with relative positioning */}
            <div className="relative w-full bg-zinc-950" id="group-chat-input-wrapper">
              {/* Emoji Picker Popover */}
              {showEmojiPicker && (
                <div className="absolute bottom-full right-4 mb-2 bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl w-72 max-w-[calc(100vw-32px)] overflow-hidden z-40 flex flex-col" id="emoji-picker-popover-group">
                  {/* Category Tabs */}
                  <div className="flex border-b border-zinc-800 bg-zinc-900/60 p-1.5 gap-1" id="emoji-categories-group">
                    <button
                      type="button"
                      onClick={() => setEmojiActiveTab('faces')}
                      className={`flex-1 py-1 rounded text-[10px] font-semibold transition-all ${emojiActiveTab === 'faces' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-white'}`}
                    >الوجوه</button>
                    <button
                      type="button"
                      onClick={() => setEmojiActiveTab('gestures')}
                      className={`flex-1 py-1 rounded text-[10px] font-semibold transition-all ${emojiActiveTab === 'gestures' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-white'}`}
                    >الأيدي</button>
                    <button
                      type="button"
                      onClick={() => setEmojiActiveTab('hearts')}
                      className={`flex-1 py-1 rounded text-[10px] font-semibold transition-all ${emojiActiveTab === 'hearts' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-white'}`}
                    >القلوب</button>
                    <button
                      type="button"
                      onClick={() => setEmojiActiveTab('symbols')}
                      className={`flex-1 py-1 rounded text-[10px] font-semibold transition-all ${emojiActiveTab === 'symbols' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-white'}`}
                    >الرموز</button>
                  </div>
                  {/* Emoji Grid */}
                  <div className="p-3 max-h-40 overflow-y-auto grid grid-cols-6 gap-2 text-center text-xl bg-zinc-950" id="emoji-grid-viewport-group">
                    {emojiCategories[emojiActiveTab].map((emoji, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => insertEmoji(emoji)}
                        className="hover:scale-125 transition-transform duration-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 rounded p-1"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                  {/* Footer */}
                  <div className="px-3 py-1.5 bg-zinc-900/40 border-t border-zinc-800 flex justify-between items-center text-[9px] text-zinc-500">
                    <span>انقر على الرمز لإدراجه</span>
                    <button
                      type="button"
                      onClick={() => setShowEmojiPicker(false)}
                      className="text-emerald-400 hover:underline"
                    >إغلاق</button>
                  </div>
                </div>
              )}

              {/* Input Bar Form */}
              <form onSubmit={handleSendMessage} className="p-3 bg-zinc-950 border-t border-zinc-800 flex gap-2" id="group-chat-input-bar">
                {/* Photo Upload Attachment Button */}
                <label className="w-11 h-11 bg-zinc-900 border border-zinc-800 hover:border-emerald-500 hover:text-emerald-400 rounded-xl flex items-center justify-center text-zinc-400 transition-colors cursor-pointer shrink-0">
                  <ImageIcon size={18} />
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    className="hidden"
                  />
                </label>

                {/* Emoji Picker Toggle Button */}
                <button
                  type="button"
                  id="btn-toggle-emoji-group"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className={`w-11 h-11 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center justify-center transition-colors shrink-0 cursor-pointer ${showEmojiPicker ? 'text-emerald-400 border-emerald-500/50' : 'text-zinc-400 hover:text-white hover:border-zinc-700'}`}
                  title="إضافة رمز تعبيري"
                >
                  <Smile size={18} />
                </button>

                <input
                  id="group-chat-text-input"
                  type="text"
                  placeholder={imageFile ? "أضف تعليقاً على الصورة (اختياري)..." : "اكتب رسالتك للكروب هنا..."}
                  value={inputText}
                  onChange={(e) => handleInputChange(e.target.value)}
                  className="flex-1 h-11 px-4 bg-zinc-900 border border-zinc-800 rounded-xl text-xs focus:outline-none focus:border-emerald-500 text-right"
                  disabled={isSending}
                />

                <button
                  id="btn-send-group-msg"
                  type="submit"
                  disabled={isSending || (!inputText.trim() && !imageFile)}
                  className="w-11 h-11 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl flex items-center justify-center transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                >
                  <Send size={16} className="transform rotate-180" />
                </button>
              </form>
            </div>
          </>
        ) : isSelectedDmActive ? (
          currentUser.role === 'admin' && !selectedContact ? (
            <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 text-xs gap-3">
              <MessageSquare size={40} className="text-zinc-600 animate-pulse" />
              <span>الرجاء اختيار عضو من القائمة الجانبية لبدء مراسلته مباشرة</span>
            </div>
          ) : (
            /* Active Private DM Chat */
            <>
              {/* Header */}
              <div className="p-4 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between" id="dm-chat-header">
                <div className="flex items-center gap-3">
                  {currentUser.role === 'admin' && selectedContact ? (
                    <>
                      <div className="w-10 h-10 rounded-xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center font-bold border border-emerald-500/20 overflow-hidden shrink-0">
                        {selectedContact.photoUrl ? (
                          <img src={selectedContact.photoUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          selectedContact.fullName.substring(0, 1)
                        )}
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-sm text-white flex items-center gap-1">
                            {selectedContact.fullName} <span className="text-sm select-none">{getUserFlag(selectedContact.id)}</span>
                          </h3>
                          <span className={`w-2 h-2 rounded-full ${isUserOnline(selectedContact) ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50 animate-pulse' : 'bg-zinc-600'}`} />
                          <span className={`text-[9px] font-bold ${isUserOnline(selectedContact) ? 'text-emerald-400' : 'text-zinc-500'}`}>
                            ({isUserOnline(selectedContact) ? 'متصل حالياً' : 'غير متصل'})
                          </span>
                        </div>
                        <p className="text-[10px] text-emerald-400 mt-0.5">مراسلة خاصة مع العضو @{selectedContact.username}</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-10 h-10 rounded-xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center font-bold border border-emerald-500/20 shrink-0">
                        A
                      </div>
                      <div className="text-right">
                        <h3 className="font-bold text-sm text-white">دردشة مالك المنصة (الأدمن)</h3>
                        <p className="text-[10px] text-emerald-400">خط مراسلة آمن ومباشر مع الدعم الفني للمالك</p>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Messages feed */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4 flex flex-col" id="dm-message-log-view">
                {currentChatMessages.length === 0 ? (
                  <div className="my-auto text-center space-y-2 text-zinc-500 text-xs">
                    <Lock className="mx-auto text-zinc-600 animate-pulse" size={32} />
                    <p>لا توجد رسائل خاصة بعد.</p>
                    <p className="text-[10px]">الرسائل في هذا القسم سرية تماماً ومباشرة.</p>
                  </div>
                ) : (
                  currentChatMessages.map((msg) => {
                    const isOwn = msg.senderId === currentUser.id;
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col max-w-[80%] ${
                          isOwn ? 'self-start items-start' : 'self-end items-end'
                        }`}
                      >
                        <div
                          className={`p-3 rounded-2xl text-xs text-right leading-relaxed ${
                            isOwn
                              ? 'bg-emerald-600 text-white rounded-br-none'
                              : 'bg-zinc-800 text-zinc-100 rounded-bl-none'
                          }`}
                        >
                          {msg.text}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-[8px] text-zinc-500">
                            {msg.createdAt?.seconds ? formatMessageTimestamp(msg.createdAt) : ''}
                          </span>
                          {isOwn && (
                            msg.read ? (
                              <CheckCheck size={12} className="text-sky-400" title="تم العرض" />
                            ) : (
                              <Check size={12} className="text-zinc-500" title="تم الإرسال" />
                            )
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Realtime Typing Indicator */}
              {typingUsers.length > 0 && (
                <div className="px-4 py-2 bg-zinc-950/90 border-t border-zinc-900 flex items-center justify-end gap-2 shrink-0" id="dm-typing-indicator-bar">
                  <span className="text-[10px] text-zinc-400 font-sans">
                    {typingUsers.map(u => u.userName).join('، ')} {typingUsers.length === 1 ? 'يكتب الآن...' : 'يكتبون الآن...'}
                  </span>
                  <div className="flex gap-0.5 items-center justify-center h-2" id="dm-typing-bubble-dots">
                    <span className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}

              {/* Input Bar Wrapper with relative positioning */}
              <div className="relative w-full bg-zinc-950" id="dm-input-wrapper">
                {/* Emoji Picker Popover */}
                {showEmojiPicker && (
                  <div className="absolute bottom-full right-4 mb-2 bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl w-72 max-w-[calc(100vw-32px)] overflow-hidden z-40 flex flex-col" id="emoji-picker-popover-dm">
                    {/* Category Tabs */}
                    <div className="flex border-b border-zinc-800 bg-zinc-900/60 p-1.5 gap-1" id="emoji-categories-dm">
                      <button
                        type="button"
                        onClick={() => setEmojiActiveTab('faces')}
                        className={`flex-1 py-1 rounded text-[10px] font-semibold transition-all ${emojiActiveTab === 'faces' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-white'}`}
                      >الوجوه</button>
                      <button
                        type="button"
                        onClick={() => setEmojiActiveTab('gestures')}
                        className={`flex-1 py-1 rounded text-[10px] font-semibold transition-all ${emojiActiveTab === 'gestures' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-white'}`}
                      >الأيدي</button>
                      <button
                        type="button"
                        onClick={() => setEmojiActiveTab('hearts')}
                        className={`flex-1 py-1 rounded text-[10px] font-semibold transition-all ${emojiActiveTab === 'hearts' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-white'}`}
                      >القلوب</button>
                      <button
                        type="button"
                        onClick={() => setEmojiActiveTab('symbols')}
                        className={`flex-1 py-1 rounded text-[10px] font-semibold transition-all ${emojiActiveTab === 'symbols' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-white'}`}
                      >الرموز</button>
                    </div>
                    {/* Emoji Grid */}
                    <div className="p-3 max-h-40 overflow-y-auto grid grid-cols-6 gap-2 text-center text-xl bg-zinc-950" id="emoji-grid-viewport-dm">
                      {emojiCategories[emojiActiveTab].map((emoji, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => insertEmoji(emoji)}
                          className="hover:scale-125 transition-transform duration-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 rounded p-1"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                    {/* Footer */}
                    <div className="px-3 py-1.5 bg-zinc-900/40 border-t border-zinc-800 flex justify-between items-center text-[9px] text-zinc-500">
                      <span>انقر على الرمز لإدراجه</span>
                      <button
                        type="button"
                        onClick={() => setShowEmojiPicker(false)}
                        className="text-emerald-400 hover:underline"
                      >إغلاق</button>
                    </div>
                  </div>
                )}

                {/* Input bar */}
                <form onSubmit={handleSendPrivateMessage} className="p-3 bg-zinc-950 border-t border-zinc-800 flex gap-2" id="dm-input-form-stage">
                  {/* Emoji Picker Toggle Button */}
                  <button
                    type="button"
                    id="btn-toggle-emoji-dm"
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    className={`w-11 h-11 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center justify-center transition-colors shrink-0 cursor-pointer ${showEmojiPicker ? 'text-emerald-400 border-emerald-500/50' : 'text-zinc-400 hover:text-white hover:border-zinc-700'}`}
                    title="إضافة رمز تعبيري"
                  >
                    <Smile size={18} />
                  </button>

                  <input
                    id="dm-chat-text-input"
                    type="text"
                    placeholder={currentUser.role === 'admin' ? "اكتب رسالتك الخاصة للعضو هنا..." : "اكتب ردك المباشر للأدمن هنا..."}
                    value={inputText}
                    onChange={(e) => handleInputChange(e.target.value)}
                    className="flex-1 h-11 px-4 bg-zinc-900 border border-zinc-800 rounded-xl text-xs focus:outline-none focus:border-emerald-500 text-right"
                    disabled={isSending}
                  />

                  <button
                    id="btn-send-dm-msg"
                    type="submit"
                    disabled={isSending || !inputText.trim()}
                    className="w-11 h-11 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl flex items-center justify-center transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                  >
                    <Send size={16} className="transform rotate-180" />
                  </button>
                </form>
              </div>
            </>
          )
        ) : (
          /* Empty State */
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 text-xs gap-3">
            <MessageSquare size={44} className="text-zinc-600 animate-pulse" />
            <span className="text-center px-4 leading-relaxed">
              يرجى اختيار كروب أو محادثة خاصة من القائمة الجانبية
              <br />
              للبدء في الدردشة الفورية المتكاملة
            </span>
          </div>
        )}
      </div>

      {/* Manual Join Group Modal Dialog */}
      <AnimatePresence>
        {showJoinModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4"
            id="join-group-modal"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-sm p-6 text-right"
              dir="rtl"
            >
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800 mb-4">
                <h3 className="font-bold text-sm text-white">الانضمام لمجموعة عبر كود الدعوة</h3>
                <button
                  id="btn-close-join-modal"
                  onClick={() => {
                    setShowJoinModal(false);
                    setJoinError('');
                    setJoinSuccess('');
                    setManualInviteCode('');
                  }}
                  className="text-zinc-400 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>

              {joinError && (
                <div className="mb-4 p-2.5 bg-red-950/50 border border-red-800 text-red-400 rounded-lg text-xs" id="join-modal-error">
                  {joinError}
                </div>
              )}

              {joinSuccess && (
                <div className="mb-4 p-2.5 bg-emerald-950/50 border border-emerald-800 text-emerald-400 rounded-lg text-xs" id="join-modal-success">
                  {joinSuccess}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label htmlFor="invite-code-input" className="block text-zinc-400 text-xs mb-1.5 mr-1">أدخل كود الدعوة (مثال: G8F9X)</label>
                  <input
                    id="invite-code-input"
                    type="text"
                    placeholder="G8F9X"
                    value={manualInviteCode}
                    onChange={(e) => setManualInviteCode(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                    className="w-full h-11 px-3 bg-zinc-950 border border-zinc-800 rounded-lg text-center text-sm font-mono tracking-widest text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <button
                  id="btn-submit-join-group"
                  onClick={() => handleJoinGroupWithCode(manualInviteCode)}
                  disabled={isJoining || !manualInviteCode.trim()}
                  className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg text-sm transition-colors cursor-pointer flex items-center justify-center disabled:opacity-50"
                >
                  {isJoining ? 'جاري التحقق والانضمام...' : 'تأكيد الانضمام للمجموعة'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Profile Modal Dialog */}
      <AnimatePresence>
        {showProfileModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4"
            id="profile-edit-modal"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-sm p-6 text-right"
              dir="rtl"
            >
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800 mb-4">
                <h3 className="font-bold text-sm text-white">تعديل الملف الشخصي</h3>
                <button
                  id="btn-close-profile-modal"
                  onClick={() => {
                    setShowProfileModal(false);
                    setProfileImageFile(null);
                    if (currentUserProfile?.photoUrl) {
                      setProfileImagePreview(currentUserProfile.photoUrl);
                    } else {
                      setProfileImagePreview('');
                    }
                  }}
                  className="text-zinc-400 hover:text-white cursor-pointer animate-none"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleUpdateProfile} className="space-y-4">
                {/* Avatar selection & upload wrapper */}
                <div className="flex flex-col items-center justify-center gap-2 mb-2">
                  <div className="relative group w-20 h-20 rounded-full overflow-hidden border-2 border-zinc-700 bg-zinc-950 flex items-center justify-center">
                    {profileImagePreview ? (
                      <img
                        src={profileImagePreview}
                        alt="Avatar Preview"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center font-bold text-lg text-zinc-500 bg-zinc-855">
                        {currentUserProfile?.fullName?.substring(0, 1) || currentUser.fullName.substring(0, 1)}
                      </div>
                    )}
                    <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white cursor-pointer transition-opacity">
                      <ImageIcon size={18} />
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            const file = e.target.files[0];
                            setProfileImageFile(file);
                            const r = new FileReader();
                            r.onloadend = () => setProfileImagePreview(r.result as string);
                            r.readAsDataURL(file);
                          }
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>
                  <span className="text-[10px] text-zinc-500">انقر على الصورة لتغييرها</span>
                </div>

                <div>
                  <label htmlFor="profile-fullname-input" className="block text-zinc-400 text-xs mb-1.5 mr-1">الاسم الكامل الجديد</label>
                  <input
                    id="profile-fullname-input"
                    type="text"
                    value={profileFullName}
                    onChange={(e) => setProfileFullName(e.target.value)}
                    className="w-full h-11 px-3 bg-zinc-950 border border-zinc-800 rounded-lg text-right text-sm text-white focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="profile-country-input" className="block text-zinc-400 text-xs mb-1.5 mr-1">الدولة العربية / الهوية الوطنية 🌍</label>
                  <div className="relative">
                    <select
                      id="profile-country-input"
                      value={profileCountry}
                      onChange={(e) => setProfileCountry(e.target.value)}
                      className="w-full h-11 px-3 bg-zinc-950 border border-zinc-800 rounded-lg text-right text-sm text-white focus:outline-none focus:border-emerald-500 appearance-none cursor-pointer font-medium"
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
                </div>

                <div className="flex gap-2">
                  <button
                    id="btn-submit-profile"
                    type="submit"
                    disabled={isUpdatingProfile}
                    className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg text-sm transition-colors cursor-pointer flex items-center justify-center disabled:opacity-50"
                  >
                    {isUpdatingProfile ? 'جاري الحفظ...' : 'حفظ التغييرات'}
                  </button>
                  <button
                    id="btn-cancel-profile"
                    type="button"
                    onClick={() => {
                      setShowProfileModal(false);
                      setProfileImageFile(null);
                      if (currentUserProfile?.photoUrl) {
                        setProfileImagePreview(currentUserProfile.photoUrl);
                      } else {
                        setProfileImagePreview('');
                      }
                    }}
                    className="px-4 h-11 bg-zinc-850 hover:bg-zinc-800 text-zinc-400 rounded-lg text-sm transition-colors cursor-pointer"
                  >
                    إلغاء
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Image Lightbox Modal */}
      <AnimatePresence>
        {zoomedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setZoomedImage(null)}
            className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-4 cursor-zoom-out"
            id="image-lightbox-modal"
          >
            <button
              id="btn-close-lightbox"
              onClick={() => setZoomedImage(null)}
              className="absolute top-4 right-4 text-zinc-400 hover:text-white bg-zinc-900/55 p-2 rounded-full cursor-pointer"
            >
              <X size={24} />
            </button>
            <motion.img
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              src={zoomedImage}
              alt="Zoomed"
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
