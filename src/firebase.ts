import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyAh-GMaX_bG7-m8nJwo17ixSjqL-xoxnWk",
  authDomain: "gen-lang-client-0017722488.firebaseapp.com",
  projectId: "gen-lang-client-0017722488",
  storageBucket: "gen-lang-client-0017722488.firebasestorage.app",
  messagingSenderId: "1030084737068",
  appId: "1:1030084737068:web:a8999b8967d418e0a27989"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore with specific database ID
const db = getFirestore(app, "ai-studio-29fab7cc-921f-4c20-8546-e457e418425b");

const auth = getAuth(app);
// Configure Auth language to Arabic
auth.useDeviceLanguage();

const storage = getStorage(app);

export { app, auth, db, storage };
