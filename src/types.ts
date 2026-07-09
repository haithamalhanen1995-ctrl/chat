export type UserRole = 'admin' | 'user';
export type UserStatus = 'active' | 'banned';

export interface ChatUser {
  id: string;
  fullName: string;
  username: string;
  phone: string;
  password?: string;
  role: UserRole;
  status: UserStatus;
  createdAt: any; // Firestore Timestamp
  photoUrl?: string;
  isOnline?: boolean;
  lastActive?: any;
  country?: string; // e.g. "IQ" or "Iraq"
}

export interface ChatGroup {
  id: string;
  name: string;
  description?: string;
  photoUrl?: string;
  inviteCode: string;
  createdBy: string;
  createdAt: any;
}

export interface GroupMember {
  id: string; // groupId_userId
  groupId: string;
  userId: string;
  joinedAt: any;
}

export interface GroupMessage {
  id: string;
  groupId: string;
  senderId: string;
  senderName: string;
  senderUsername: string;
  text: string;
  photoUrl?: string;
  createdAt: any;
  editedAt?: any;
}

export interface PrivateMessage {
  id: string;
  chatId: string; // adminId_userId
  senderId: string;
  receiverId: string;
  text: string;
  createdAt: any;
  read?: boolean;
}

export interface InviteLink {
  id: string; // inviteCode
  groupId: string;
  createdAt: any;
}

export interface InAppNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: 'mention' | 'new_message' | 'private_message';
  chatId: string;
  isRead: boolean;
  createdAt: any;
  senderName: string;
}

