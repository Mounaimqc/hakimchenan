// firebase-config.js - HAKIM CHENAN NUTRITION
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";

// Configuration Firebase - Hakim Chenan Nutrition
const firebaseConfig = {
  apiKey: "AIzaSyBoaF2YBY8MQJZ4KIMGN2ZOtiWrYrIGdSE",
  authDomain: "hakimchenan-7e948.firebaseapp.com",
  projectId: "hakimchenan-7e948",
  storageBucket: "hakimchenan-7e948.firebasestorage.app",
  messagingSenderId: "478342811074",
  appId: "1:478342811074:web:83d75a290e97a4da925a5b",
  measurementId: "G-9XHYJWJHME"
};

// Initialisation Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Initialisation Analytics conditionnelle et sécurisée
export let analytics = null;
if (typeof window !== 'undefined') {
  isSupported().then(supported => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch(() => {});
}

export { app };
