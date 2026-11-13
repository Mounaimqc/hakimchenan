// shipping-service.js - Gestion Dynamique des Tarifs de Livraison (58 Wilayas)
// Permet la lecture et la modification des tarifs Domicile et Stop Desk depuis le Dashboard

export const DEFAULT_SHIPPING_PRICES = {
  "01 - Adrar": 1500, "02 - Chlef": 800, "03 - Laghouat": 1000, "04 - Oum El Bouaghi": 800,
  "05 - Batna": 800, "06 - Béjaïa": 800, "07 - Biskra": 1000, "08 - Béchar": 1200,
  "09 - Blida": 600, "10 - Bouira": 700, "11 - Tamanrasset": 2000, "12 - Tébessa": 900,
  "13 - Tlemcen": 800, "14 - Tiaret": 900, "15 - Tizi Ouzou": 700, "16 - Alger": 500,
  "17 - Djelfa": 1000, "18 - Jijel": 800, "19 - Sétif": 800, "20 - Saïda": 900,
  "21 - Skikda": 800, "22 - Sidi Bel Abbès": 800, "23 - Annaba": 800, "24 - Guelma": 900,
  "25 - Constantine": 800, "26 - Médéa": 700, "27 - Mostaganem": 800, "28 - M'Sila": 800,
  "29 - Mascara": 800, "30 - Ouargla": 1100, "31 - Oran": 800, "32 - El Bayadh": 1200,
  "33 - Illizi": 1900, "34 - Bordj Bou Arréridj": 800, "35 - Boumerdès": 600, "36 - El Tarf": 900,
  "37 - Tindouf": 1700, "38 - Tissemsilt": 800, "39 - El Oued": 1100, "40 - Khenchela": 900,
  "41 - Souk Ahras": 900, "42 - Tipaza": 600, "43 - Mila": 800, "44 - Aïn Defla": 800,
  "45 - Naâma": 1200, "46 - Aïn Témouchent": 800, "47 - Ghardaïa": 1100, "48 - Relizane": 800,
  "49 - Timimoun": 1500, "50 - Bordj Badji Mokhtar": 1500, "51 - Ouled Djellal": 1000,
  "52 - Béni Abbès": 1200, "53 - In Salah": 1800, "54 - In Guezzam": 3500,
  "55 - Touggourt": 1000, "56 - Djanet": 2200, "57 - El M'Ghair": 1800, "58 - El Meniaa": 1100
};

export const DEFAULT_STOPDESK_PRICES = {
  "01 - Adrar": 1000, "02 - Chlef": 500, "03 - Laghouat": 600, "04 - Oum El Bouaghi": 500,
  "05 - Batna": 500, "06 - Béjaïa": 500, "07 - Biskra": 600, "08 - Béchar": 800,
  "09 - Blida": 400, "10 - Bouira": 450, "11 - Tamanrasset": 1500, "12 - Tébessa": 600,
  "13 - Tlemcen": 500, "14 - Tiaret": 600, "15 - Tizi Ouzou": 450, "16 - Alger": 300,
  "17 - Djelfa": 600, "18 - Jijel": 500, "19 - Sétif": 550, "20 - Saïda": 600,
  "21 - Skikda": 500, "22 - Sidi Bel Abbès": 500, "23 - Annaba": 500, "24 - Guelma": 600,
  "25 - Constantine": 500, "26 - Médéa": 450, "27 - Mostaganem": 500, "28 - M'Sila": 500,
  "29 - Mascara": 500, "30 - Ouargla": 700, "31 - Oran": 500, "32 - El Bayadh": 800,
  "33 - Illizi": 1500, "34 - Bordj Bou Arréridj": 500, "35 - Boumerdès": 400, "36 - El Tarf": 600,
  "37 - Tindouf": 1000, "38 - Tissemsilt": 500, "39 - El Oued": 700, "40 - Khenchela": 600,
  "41 - Souk Ahras": 600, "42 - Tipaza": 400, "43 - Mila": 500, "44 - Aïn Defla": 500,
  "45 - Naâma": 800, "46 - Aïn Témouchent": 500, "47 - Ghardaïa": 700, "48 - Relizane": 500,
  "49 - Timimoun": 1000, "50 - Bordj Badji Mokhtar": 1000, "51 - Ouled Djellal": 600,
  "52 - Béni Abbès": 800, "53 - In Salah": 1200, "54 - In Guezzam": 3500,
  "55 - Touggourt": 600, "56 - Djanet": 1600, "57 - El M'Ghair": 1800, "58 - El Meniaa": 800
};

// Tarifs actifs en mémoire
export let activeShippingPrices = { ...DEFAULT_SHIPPING_PRICES };
export let activeStopDeskPrices = { ...DEFAULT_STOPDESK_PRICES };

// Charger le cache local au démarrage
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    const cachedDomicile = localStorage.getItem('hcn_shipping_domicile');
    const cachedStopdesk = localStorage.getItem('hcn_shipping_stopdesk');
    if (cachedDomicile) activeShippingPrices = { ...DEFAULT_SHIPPING_PRICES, ...JSON.parse(cachedDomicile) };
    if (cachedStopdesk) activeStopDeskPrices = { ...DEFAULT_STOPDESK_PRICES, ...JSON.parse(cachedStopdesk) };
  }
} catch (e) {
  console.warn("Erreur lecture cache livraison:", e);
}

/**
 * Charge les tarifs en direct depuis Firestore
 */
export async function fetchLiveShippingRates(db) {
  try {
    const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    const docRef = doc(db, "parametres", "livraison");
    const snap = await getDoc(docRef);

    if (snap.exists()) {
      const data = snap.data();
      if (data.domicile && typeof data.domicile === 'object') {
        activeShippingPrices = { ...DEFAULT_SHIPPING_PRICES, ...data.domicile };
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem('hcn_shipping_domicile', JSON.stringify(activeShippingPrices));
        }
      }
      if (data.stopdesk && typeof data.stopdesk === 'object') {
        activeStopDeskPrices = { ...DEFAULT_STOPDESK_PRICES, ...data.stopdesk };
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem('hcn_shipping_stopdesk', JSON.stringify(activeStopDeskPrices));
        }
      }
      console.log("🚚 Tarifs de livraison personnalisés chargés depuis Firestore");
    }
  } catch (err) {
    console.warn("Utilisation des tarifs par défaut (Firestore non disponible):", err.message);
  }

  return {
    domicile: activeShippingPrices,
    stopdesk: activeStopDeskPrices
  };
}

/**
 * Enregistre les tarifs de livraison dans Firestore
 */
export async function saveShippingRatesToFirestore(db, domicileRates, stopdeskRates) {
  const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
  const docRef = doc(db, "parametres", "livraison");

  const payload = {
    domicile: domicileRates,
    stopdesk: stopdeskRates,
    updatedAt: new Date().toISOString()
  };

  await setDoc(docRef, payload, { merge: true });

  activeShippingPrices = { ...domicileRates };
  activeStopDeskPrices = { ...stopdeskRates };

  if (typeof window !== 'undefined' && window.localStorage) {
    localStorage.setItem('hcn_shipping_domicile', JSON.stringify(activeShippingPrices));
    localStorage.setItem('hcn_shipping_stopdesk', JSON.stringify(activeStopDeskPrices));
  }

  return true;
}

/**
 * Calcule le tarif pour une wilaya et un type de livraison
 */
export function getShippingRate(wilayaKeyOrCode, orderType = 'domicile') {
  if (!wilayaKeyOrCode) return 0;

  // Si c'est juste un code (ex: "16" ou "09")
  let targetKey = wilayaKeyOrCode;
  if (!targetKey.includes(' - ')) {
    const padded = String(wilayaKeyOrCode).padStart(2, '0');
    const found = Object.keys(activeShippingPrices).find(k => k.startsWith(padded + ' - '));
    if (found) targetKey = found;
  }

  const rates = orderType === 'stopdesk' ? activeStopDeskPrices : activeShippingPrices;
  return rates[targetKey] || 0;
}
