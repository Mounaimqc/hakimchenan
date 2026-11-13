/**
 * HAKIM CHENAN NUTRITION - Authentication & Customer Service
 * Handles customer registration, reseller applications, role management,
 * session storage, and security validations.
 */

import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from './firebase-config.js';

// ==========================================
// 🔒 CRYPTO HELPERS (SHA-256 with Salt)
// ==========================================

export async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + "::" + password + "::hcn_secure_2026");
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateSalt(length = 16) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

// Clean and normalize phone numbers (e.g., "0555 12 34 56" -> "0555123456")
export function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/[\s\-\.\(\)\+]/g, '').trim();
}

// ==========================================
// 👤 SESSION MANAGEMENT
// ==========================================

const SESSION_KEY = 'hcn_current_user';
const SESSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function getCurrentUser() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw);
    if (!user || !user.id) return null;
    if (user.loginTime && (Date.now() - user.loginTime > SESSION_EXPIRY_MS)) {
      logout();
      return null;
    }
    return user;
  } catch (e) {
    console.error("Session parse error:", e);
    return null;
  }
}

export function setCurrentUser(user) {
  const sessionData = {
    id: user.id,
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
    phone: user.phone || '',
    email: user.email || '',
    wilaya: user.wilaya || '',
    commune: user.commune || '',
    role: user.role || 'customer', // 'customer' | 'reseller' | 'admin'
    status: user.status || 'active', // 'active' | 'pending' | 'suspended' | 'rejected'
    businessName: user.businessName || '',
    businessAddress: user.businessAddress || '',
    notes: user.notes || '',
    loginTime: Date.now()
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
  window.dispatchEvent(new CustomEvent('hcn:auth-change', { detail: sessionData }));
  return sessionData;
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new CustomEvent('hcn:auth-change', { detail: null }));
}

/**
 * Checks whether the current logged-in user is an APPROVED reseller.
 * Guest visitors, regular customers, pending resellers, suspended or rejected resellers ALL return false.
 */
export function isApprovedReseller(user = null) {
  const target = user || getCurrentUser();
  if (!target) return false;
  return target.role === 'reseller' && target.status === 'approved';
}

/**
 * Checks whether user is a pending reseller.
 */
export function isPendingReseller(user = null) {
  const target = user || getCurrentUser();
  if (!target) return false;
  return target.role === 'reseller' && target.status === 'pending';
}

/**
 * Refresh current user session from Firestore to reflect latest admin approvals/suspensions
 */
export async function refreshUserSession() {
  const current = getCurrentUser();
  if (!current || !current.id) return null;

  try {
    const userDoc = await getDoc(doc(db, "clients", current.id));
    if (userDoc.exists()) {
      const data = userDoc.data();
      // If user was suspended, log them out
      if (data.status === 'suspended') {
        logout();
        return null;
      }
      return setCurrentUser({ id: userDoc.id, ...data });
    }
  } catch (err) {
    console.error("Error refreshing session:", err);
  }
  return current;
}

// ==========================================
// 📝 REGISTRATION & LOGIN
// ==========================================

/**
 * Register a regular customer
 */
export async function registerCustomer({ firstName, lastName, phone, email, password, wilaya, commune }) {
  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone || cleanPhone.length < 8) {
    throw new Error("Numéro de téléphone invalide.");
  }
  if (!password || password.length < 6) {
    throw new Error("Le mot de passe doit contenir au moins 6 caractères.");
  }
  if (!firstName || !lastName || !wilaya || !commune) {
    throw new Error("Veuillez remplir tous les champs obligatoires.");
  }

  // Check if phone already registered
  const q = query(collection(db, "clients"), where("phone", "==", cleanPhone));
  const snap = await getDocs(q);
  if (!snap.empty) {
    throw new Error("Un compte existe déjà avec ce numéro de téléphone.");
  }

  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);

  const newClient = {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    phone: cleanPhone,
    email: (email || '').trim().toLowerCase(),
    passwordHash,
    salt,
    wilaya,
    commune,
    role: 'customer',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const docRef = await addDoc(collection(db, "clients"), newClient);
  const user = { id: docRef.id, ...newClient };
  return setCurrentUser(user);
}

/**
 * Apply to become a reseller (creates account with role 'reseller' and status 'pending')
 */
export async function registerResellerApplication({
  fullName, firstName, lastName, phone, email, password, wilaya, commune,
  businessName = '', businessAddress = '', notes = ''
}) {
  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone || cleanPhone.length < 8) {
    throw new Error("Numéro de téléphone invalide.");
  }
  if (!password || password.length < 6) {
    throw new Error("Le mot de passe doit contenir au moins 6 caractères.");
  }

  let fName = (firstName || '').trim();
  let lName = (lastName || '').trim();
  if (!fName && fullName) {
    const parts = fullName.trim().split(' ');
    fName = parts[0] || '';
    lName = parts.slice(1).join(' ') || '';
  }

  if (!fName) {
    throw new Error("Le nom complet est obligatoire.");
  }

  // Check if user already exists
  const q = query(collection(db, "clients"), where("phone", "==", cleanPhone));
  const snap = await getDocs(q);
  let clientId = null;

  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);

  const applicationData = {
    firstName: fName,
    lastName: lName,
    fullName: `${fName} ${lName}`.trim(),
    phone: cleanPhone,
    email: (email || '').trim().toLowerCase(),
    wilaya,
    commune,
    businessName: businessName.trim(),
    businessAddress: businessAddress.trim(),
    notes: notes.trim(),
    role: 'reseller',
    status: 'pending', // CRITICAL: starts as PENDING, wholesale prices NOT enabled
    appliedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (!snap.empty) {
    // Existing customer upgrading to reseller
    const existingDoc = snap.docs[0];
    clientId = existingDoc.id;
    await updateDoc(doc(db, "clients", clientId), {
      ...applicationData,
      passwordHash, // update password if provided
      salt
    });
  } else {
    // Brand new account
    const docRef = await addDoc(collection(db, "clients"), {
      ...applicationData,
      passwordHash,
      salt,
      createdAt: new Date().toISOString()
    });
    clientId = docRef.id;
  }

  // Also log into `demandes_revendeurs` for quick admin access and audit trail
  const appDocRef = await addDoc(collection(db, "demandes_revendeurs"), {
    clientId,
    ...applicationData,
    date: new Date().toISOString()
  });

  const sessionUser = { id: clientId, ...applicationData };
  setCurrentUser(sessionUser);

  return { success: true, clientId, applicationId: appDocRef.id, status: 'pending' };
}

/**
 * Login customer or reseller with phone and password
 */
export async function loginCustomer(phoneOrEmail, password) {
  if (!phoneOrEmail || !password) {
    throw new Error("Veuillez saisir votre identifiant et mot de passe.");
  }

  const cleanInput = phoneOrEmail.trim();
  const cleanPhone = normalizePhone(cleanInput);

  let userDoc = null;
  let userData = null;

  // Search by phone first
  let q = query(collection(db, "clients"), where("phone", "==", cleanPhone));
  let snap = await getDocs(q);

  // If not found and input looks like email, search by email
  if (snap.empty && cleanInput.includes('@')) {
    q = query(collection(db, "clients"), where("email", "==", cleanInput.toLowerCase()));
    snap = await getDocs(q);
  }

  if (snap.empty) {
    throw new Error("Identifiant ou mot de passe incorrect.");
  }

  userDoc = snap.docs[0];
  userData = userDoc.data();

  // Verify password hash
  const computedHash = await hashPassword(password, userData.salt || '');
  if (computedHash !== userData.passwordHash) {
    // Fallback check: in case old plain text or special dev password
    if (password !== userData.password) {
      throw new Error("Identifiant ou mot de passe incorrect.");
    }
  }

  // Check account status
  if (userData.status === 'suspended') {
    throw new Error("Votre compte a été suspendu par l'administration. Veuillez nous contacter.");
  }

  const sessionUser = {
    id: userDoc.id,
    ...userData
  };

  return setCurrentUser(sessionUser);
}

// ==========================================
// 🛡️ SERVER-SIDE PRICE VALIDATION (CRITICAL)
// ==========================================

/**
 * Validates cart prices against the live Firestore product catalog.
 * Strict rule: NEVER trust client-submitted prices!
 * - If user is verified approved reseller, applies product.reseller_price (if enabled and > 0)
 * - Otherwise, applies regular product.price
 * Returns validated items array, subtotal, and any price discrepancies.
 */
export async function validateOrderPrices(cartItems, customerUser = null) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    throw new Error("Le panier est vide.");
  }

  // Verify reseller status directly from database if a user ID is supplied
  let userIsApprovedReseller = false;
  let verifiedCustomer = null;

  if (customerUser && customerUser.id) {
    try {
      const clientSnap = await getDoc(doc(db, "clients", customerUser.id));
      if (clientSnap.exists()) {
        const cData = clientSnap.data();
        verifiedCustomer = { id: clientSnap.id, ...cData };
        userIsApprovedReseller = (cData.role === 'reseller' && cData.status === 'approved');
      }
    } catch (e) {
      console.warn("Could not verify customer doc in DB, defaulting to regular prices:", e);
    }
  }

  const validatedItems = [];
  let cartTotal = 0;

  for (const item of cartItems) {
    if (!item.id) continue;
    const prodSnap = await getDoc(doc(db, "produits", item.id));
    if (!prodSnap.exists()) {
      throw new Error(`Le produit "${item.name || item.id}" n'existe plus en boutique.`);
    }

    const prodData = prodSnap.data();
    const regularPrice = parseFloat(prodData.price) || 0;
    const resellerPrice = parseFloat(prodData.reseller_price) || 0;
    const resellerEnabled = prodData.reseller_pricing_enabled === true || prodData.reseller_pricing_enabled === 'true';

    // Apply wholesale price ONLY if user is verified approved reseller AND reseller pricing is enabled
    let effectiveUnitPrice = regularPrice;
    let isWholesaleApplied = false;

    if (userIsApprovedReseller && resellerEnabled && resellerPrice > 0) {
      effectiveUnitPrice = resellerPrice;
      isWholesaleApplied = true;
    }

    const quantity = Math.max(1, parseInt(item.quantity) || 1);
    const itemTotal = effectiveUnitPrice * quantity;
    cartTotal += itemTotal;

    validatedItems.push({
      id: item.id,
      name: prodData.name || item.name,
      image: prodData.image || item.image || '',
      flavor: item.flavor || null,
      unitPrice: effectiveUnitPrice,
      regularPrice: regularPrice,
      wholesalePrice: resellerPrice,
      isWholesale: isWholesaleApplied,
      quantity: quantity,
      total: itemTotal
    });
  }

  return {
    items: validatedItems,
    cartTotal: Math.round(cartTotal * 100) / 100,
    isWholesaleOrder: userIsApprovedReseller,
    verifiedCustomer
  };
}

// ==========================================
// 📜 AUDIT LOGGING HELPER
// ==========================================

export async function logAdminAction(action, targetType, targetId, details = {}) {
  try {
    const adminUser = localStorage.getItem('userName') || 'Admin';
    await addDoc(collection(db, "audit_logs"), {
      action,
      targetType,
      targetId,
      details,
      adminUser,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("Audit log error:", err);
  }
}

export default {
  hashPassword,
  generateSalt,
  normalizePhone,
  getCurrentUser,
  setCurrentUser,
  logout,
  isApprovedReseller,
  isPendingReseller,
  refreshUserSession,
  registerCustomer,
  registerResellerApplication,
  loginCustomer,
  validateOrderPrices,
  logAdminAction
};
