// admin.js - HAKIM CHENAN NUTRITION Admin Dashboard
// Orders, Reseller Applications, Customer Management, Audit Logging, and Wholesale Pricing

import { 
  collection, getDocs, orderBy, query, doc, updateDoc, deleteDoc, addDoc, onSnapshot, where, getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from './firebase-config.js';
import { logAdminAction } from './auth-service.js';
import { backupDatabase, migrateProductsSchema } from './migration-init.js';
import { 
  fetchLiveShippingRates, saveShippingRatesToFirestore, DEFAULT_SHIPPING_PRICES, DEFAULT_STOPDESK_PRICES,
  activeShippingPrices, activeStopDeskPrices
} from './shipping-service.js';

// Global state
let allCommandes = [];
let allResellers = [];
let allCustomers = [];
let allAuditLogs = [];
let currentSelectedCustomer = null;
let currentTab = 'commandes';

export function sanitizeImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  url = url.trim();
  if (!url) return '';

  const match = url.match(/[?&]url=([^&]+)/i);
  if (match && match[1]) {
    try {
      const decoded = decodeURIComponent(match[1]);
      if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
        return decoded;
      }
    } catch (e) {}
  }

  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:') && !url.startsWith('blob:')) {
    url = 'https://' + url;
  }

  return url;
}

// ==========================================
// 🔄 TAB SWITCHING
// ==========================================

export function switchAdminTab(tab) {
  currentTab = tab;
  const sections = {
    commandes: document.getElementById('sectionCommandes'),
    resellers: document.getElementById('sectionResellers'),
    customers: document.getElementById('sectionCustomers'),
    shipping: document.getElementById('sectionShipping'),
    audit: document.getElementById('sectionAudit')
  };

  const navLinks = {
    commandes: document.getElementById('navLinkCommandes'),
    resellers: document.getElementById('navLinkResellers'),
    customers: document.getElementById('navLinkCustomers'),
    shipping: document.getElementById('navLinkShipping'),
    audit: document.getElementById('navLinkAudit')
  };

  const titles = {
    commandes: { title: "📊 Tableau de bord Commandes", sub: "Gérez vos commandes en temps réel" },
    resellers: { title: "🤝 Gestion des Revendeurs", sub: "Candidatures, approbations et tarifs de gros" },
    customers: { title: "👥 Gestion des Clients", sub: "Tous les comptes clients et revendeurs" },
    shipping: { title: "🚚 Tarifs de Livraison", sub: "Modifiez les prix de livraison domicile et stop desk par wilaya" },
    audit: { title: "🛡️ Audit & Système", sub: "Journal d'audit de sécurité et maintenance de la base" }
  };

  Object.keys(sections).forEach(key => {
    if (sections[key]) sections[key].style.display = (key === tab) ? 'block' : 'none';
    if (navLinks[key]) {
      if (key === tab) navLinks[key].classList.add('active');
      else navLinks[key].classList.remove('active');
    }
  });

  const headingEl = document.getElementById('pageTitleHeading');
  const subEl = document.getElementById('pageTitleSub');
  if (headingEl && titles[tab]) headingEl.textContent = titles[tab].title;
  if (subEl && titles[tab]) subEl.textContent = titles[tab].sub;

  if (window.location.hash !== `#${tab}`) {
    window.location.hash = tab;
  }

  // Load relevant data on tab change
  if (tab === 'commandes' && allCommandes.length === 0) loadCommandes();
  if (tab === 'resellers') loadResellers();
  if (tab === 'customers') loadCustomers();
  if (tab === 'shipping') loadShippingAdmin();
  if (tab === 'audit') loadAuditLogs();
}
window.switchAdminTab = switchAdminTab;

// ==========================================
// 📦 ORDERS MANAGEMENT (EXISTING FEATURE)
// ==========================================

function loadCommandes() {
  const tbody = document.getElementById('ordersTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px"><i class="fa-solid fa-circle-notch fa-spin"></i> Chargement...</td></tr>`;

  const q = query(collection(db, "commandes"), orderBy("date", "desc"));

  onSnapshot(q, (snapshot) => {
    allCommandes = [];
    snapshot.forEach(docSnap => {
      allCommandes.push({ id: docSnap.id, ...docSnap.data() });
    });

    displayCommandes(allCommandes);
    updateStats();
    initializeWilayaFilter();

    if (allCommandes.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-light)">Aucune commande pour le moment</td></tr>`;
    }
  }, (error) => {
    console.error("❌ Erreur Firebase:", error);
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--danger)">Erreur: ${error.message}</td></tr>`;
  });
}

function displayCommandes(commandes) {
  const tbody = document.getElementById('ordersTableBody');
  if (!tbody) return;

  if (commandes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-light)">Aucune commande trouvée</td></tr>`;
    return;
  }

  tbody.innerHTML = commandes.map(cmd => {
    const statusClass = getStatusClass(cmd.status || 'pending');
    const statusLabel = getStatusLabel(cmd.status || 'pending');
    const wholesaleTag = cmd.isWholesaleOrder ? `<span style="font-size:0.7rem;background:rgba(255,184,0,0.2);color:var(--primary);padding:2px 6px;border-radius:4px;margin-left:4px;">Gros</span>` : '';

    return `
      <tr>
        <td style="font-weight:600;color:var(--primary)">#${cmd.orderNumber} ${wholesaleTag}</td>
        <td>${cmd.firstName || ''} ${cmd.lastName || ''}</td>
        <td><span style="font-size:.85rem"><i class="fa-solid ${cmd.orderType === 'domicile' ? 'fa-truck' : 'fa-store'}"></i> ${cmd.orderType === 'domicile' ? 'Domicile' : 'Stop Desk'}</span></td>
        <td>${cmd.wilaya || '-'}</td>
        <td>${cmd.phone1 || '-'}</td>
        <td style="font-weight:600">${(cmd.grandTotal || 0).toFixed(2)} DA</td>
        <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
        <td>
          <button onclick="showDetail('${cmd.orderNumber}')" style="padding:6px 12px;background:var(--primary);color:#000;border:none;border-radius:4px;cursor:pointer;font-weight:600;">Détails</button>
          <button onclick="deleteCommande('${cmd.orderNumber}')" style="padding:6px 12px;background:var(--danger);color:#fff;border:none;border-radius:4px;cursor:pointer;margin-left:5px">🗑</button>
        </td>
      </tr>`;
  }).join('');
}

function showDetail(orderNumber) {
  const cmd = allCommandes.find(c => c.orderNumber === orderNumber);
  if (!cmd) {
    showNotification('❌ Commande introuvable', 'error');
    return;
  }

  document.getElementById('detailModal').dataset.firebaseId = cmd.id;
  document.getElementById('detailModal').dataset.currentOrderNumber = orderNumber;
  document.getElementById('detailOrderNumber').textContent = cmd.orderNumber;
  document.getElementById('detailDate').textContent = formatDateTime(cmd.date);
  document.getElementById('detailName').textContent = `${cmd.firstName || ''} ${cmd.lastName || ''} ${cmd.isWholesaleOrder ? '(Revendeur Agréé)' : ''}`;
  document.getElementById('detailPhone1').textContent = cmd.phone1 || '—';
  document.getElementById('detailPhone1').href = cmd.phone1 ? `tel:${cmd.phone1}` : '#';
  document.getElementById('detailPhone2').textContent = cmd.phone2 || '—';
  document.getElementById('detailWilaya').textContent = cmd.wilaya || '—';
  document.getElementById('detailCommune').textContent = cmd.commune || '—';

  const status = cmd.status || 'pending';
  const badge = document.getElementById('detailStatusBadge');
  badge.textContent = getStatusLabel(status);
  badge.className = 'status-badge ' + getStatusClass(status);
  document.getElementById('statusSelect').value = status;

  const itemsContainer = document.getElementById('detailItems');
  const cartItems = cmd.cartItems || cmd.items || cmd.products || [];

  if (cartItems.length > 0) {
    itemsContainer.innerHTML = cartItems.map((item, index) => {
      const itemImage = item.image || item.imageUrl || item.img || '';
      const itemName = item.name || item.productName || `Produit ${index + 1}`;
      const itemPrice = item.unitPrice || item.price || 0;
      const itemQuantity = item.quantity || item.qty || 1;
      const itemFlavor = item.flavor || item.variant || '';
      const itemTotal = itemPrice * itemQuantity;

      return `
        <div class="detail-item" style="display:flex; gap:12px; padding:12px; background:var(--bg); border-radius:var(--radius); margin-bottom:10px; border:1px solid var(--border);">
          ${itemImage ? `
            <div style="flex-shrink:0; width:60px; height:60px; background:var(--surface); border-radius:var(--radius); overflow:hidden; display:flex; align-items:center; justify-content:center;">
              <img src="${itemImage}" alt="${itemName}" style="max-width:100%; max-height:100%; object-fit:contain;" onerror="this.style.display='none'">
            </div>
          ` : ''}
          <div style="flex:1; min-width:0;">
            <div style="font-weight:600; font-size:0.95rem; margin-bottom:4px; color:var(--text);">
              ${itemName}
              ${itemFlavor ? `<span style="color:var(--primary); font-size:0.8rem; margin-left:8px;">(${itemFlavor})</span>` : ''}
              ${item.isWholesale ? `<span style="font-size:0.7rem;background:rgba(255,184,0,0.2);color:var(--primary);padding:2px 6px;border-radius:4px;margin-left:6px;">Prix Gros</span>` : ''}
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div style="color:var(--text-light); font-size:0.85rem;">
                <span style="font-weight:600; color:var(--primary);">${itemQuantity}×</span> 
                <span>${itemPrice.toFixed(2)} DA</span>
              </div>
              <div style="font-weight:700; color:var(--primary); font-family:'Montserrat',sans-serif;">
                ${itemTotal.toFixed(2)} DA
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } else {
    itemsContainer.innerHTML = `<p style="text-align:center; padding:20px; color:var(--text-light);">Aucun détail produit</p>`;
  }

  document.getElementById('detailCartTotal').textContent = (cmd.cartTotal || 0).toFixed(2);
  document.getElementById('detailShipping').textContent = (cmd.shippingPrice || 0).toFixed(2);
  document.getElementById('detailTotal').textContent = (cmd.grandTotal || 0).toFixed(2);

  toggleDriverSection(cmd);
  document.getElementById('detailModal').classList.add('active');
}

function closeDetail() { document.getElementById('detailModal').classList.remove('active'); }

function toggleDriverSection(order) {
  const driverSection = document.getElementById('driverSection');
  if (!driverSection) return;
  if (order.orderType === 'domicile') {
    driverSection.style.display = 'block';
    document.getElementById('driverName').value = order.driverName || '';
    document.getElementById('driverPhone').value = order.driverPhone || '';
  } else {
    driverSection.style.display = 'none';
  }
}

function getStatusClass(s) {
  return { pending: 'status-pending', accepted: 'status-accepted', shipped: 'status-shipped', arrived: 'status-arrived', returned: 'status-returned' }[s] || 'status-pending';
}
function getStatusLabel(s) {
  return { pending: '⏳ En attente', accepted: '✓ Acceptée', shipped: '🚚 En route', arrived: '📦 Arrivée', returned: '↩️ Retournée' }[s] || '⏳ En attente';
}

function confirmStatusUpdate() { updateOrderStatus(document.getElementById('statusSelect').value); }

function updateOrderStatus(newStatus) {
  const firebaseId = document.getElementById('detailModal')?.dataset.firebaseId;
  const orderNumber = document.getElementById('detailModal')?.dataset.currentOrderNumber;

  if (!firebaseId) {
    showNotification('Erreur: ID manquant', 'error');
    return;
  }

  const driverData = {};
  const driverName = document.getElementById('driverName')?.value.trim();
  const driverPhone = document.getElementById('driverPhone')?.value.trim();
  if (driverName) driverData.driverName = driverName;
  if (driverPhone) driverData.driverPhone = driverPhone;

  updateDoc(doc(db, "commandes", firebaseId), { 
    status: newStatus, ...driverData, driverUpdatedAt: new Date().toISOString()
  })
    .then(() => {
      const cmd = allCommandes.find(c => c.orderNumber === orderNumber);
      if (cmd) {
        cmd.status = newStatus;
        if (driverData.driverName) cmd.driverName = driverData.driverName;
        if (driverData.driverPhone) cmd.driverPhone = driverData.driverPhone;
      }
      displayCommandes(allCommandes);
      logAdminAction("UPDATE_ORDER_STATUS", "commandes", orderNumber, { status: newStatus });
      showNotification('✅ Statut mis à jour', 'success');
      closeDetail();
    })
    .catch((error) => {
      console.error("Erreur:", error);
      showNotification('❌ Erreur mise à jour', 'error');
    });
}

function deleteCommande(orderNumber) {
  if (!confirm(`Supprimer définitivement la commande ${orderNumber} ?`)) return;

  const cmd = allCommandes.find(c => c.orderNumber === orderNumber);
  if (!cmd?.id) { showNotification('Commande introuvable', 'error'); return; }

  deleteDoc(doc(db, "commandes", cmd.id))
    .then(() => {
      allCommandes = allCommandes.filter(c => c.orderNumber !== orderNumber);
      displayCommandes(allCommandes);
      updateStats();
      logAdminAction("DELETE_ORDER", "commandes", orderNumber);
      showNotification('✅ Commande supprimée', 'success');
    })
    .catch((error) => {
      console.error("Erreur:", error);
      showNotification('❌ Erreur suppression', 'error');
    });
}

function filterCommandes() {
  const search = document.getElementById('searchInput')?.value.toLowerCase() || '';
  const type = document.getElementById('filterType')?.value || '';
  const wilaya = document.getElementById('filterWilaya')?.value || '';

  const filtered = allCommandes.filter(c => {
    const matchSearch = c.orderNumber?.toLowerCase().includes(search) ||
      c.firstName?.toLowerCase().includes(search) ||
      c.lastName?.toLowerCase().includes(search) ||
      c.phone1?.includes(search);
    return matchSearch && (!type || c.orderType === type) && (!wilaya || c.wilaya === wilaya);
  });
  displayCommandes(filtered);
}

function clearFilters() {
  if (document.getElementById('searchInput')) document.getElementById('searchInput').value = '';
  if (document.getElementById('filterType')) document.getElementById('filterType').value = '';
  if (document.getElementById('filterWilaya')) document.getElementById('filterWilaya').value = '';
  filterCommandes();
}

function updateStats() {
  const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  el('totalCommandes', allCommandes.length);
  const total = allCommandes.reduce((sum, c) => sum + (c.grandTotal || 0), 0);
  el('totalRevenu', total.toFixed(2) + ' DA');
  el('totalDomicile', allCommandes.filter(c => c.orderType === 'domicile').length);
  el('totalStopdesk', allCommandes.filter(c => c.orderType === 'stopdesk').length);
}

function initializeWilayaFilter() {
  const select = document.getElementById('filterWilaya');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Toutes les wilayas</option>';
  [...new Set(allCommandes.map(c => c.wilaya).filter(Boolean))].sort().forEach(w => {
    const opt = document.createElement('option');
    opt.value = w; opt.textContent = w;
    select.appendChild(opt);
  });
  select.value = current;
}

function exportCommandes() {
  if (allCommandes.length === 0) { showNotification('Aucune commande à exporter', 'error'); return; }
  let csv = 'N°;Client;Téléphone;Wilaya;Commune;Type;Total;Statut;Date;TypeClient\n';
  allCommandes.forEach(c => {
    csv += `"${c.orderNumber}";"${c.firstName || ''} ${c.lastName || ''}";"${c.phone1 || ''}";"${c.wilaya || ''}";"${c.commune || ''}";"${c.orderType || ''}";"${(c.grandTotal || 0).toFixed(2)}";"${c.status || 'pending'}";"${c.date || ''}";"${c.isWholesaleOrder ? 'Revendeur' : 'Standard'}"\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `commandes_hcn_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  showNotification('✅ Export CSV téléchargé', 'success');
}

// ==========================================
// 🤝 RESELLER MANAGEMENT (REQUIREMENT 6)
// ==========================================

export function loadResellers() {
  const tbody = document.getElementById('resellersTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px"><i class="fa-solid fa-circle-notch fa-spin"></i> Chargement des revendeurs...</td></tr>`;

  // Fetch all clients with role 'reseller' or any doc in 'demandes_revendeurs'
  const q = query(collection(db, "clients"), where("role", "==", "reseller"));

  onSnapshot(q, (snapshot) => {
    allResellers = [];
    snapshot.forEach(docSnap => {
      allResellers.push({ id: docSnap.id, ...docSnap.data() });
    });

    displayResellers(allResellers);
    updateResellerStats();
  }, (err) => {
    console.error("Resellers error:", err);
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--danger)">Erreur: ${err.message}</td></tr>`;
  });
}
window.loadResellers = loadResellers;

function updateResellerStats() {
  const total = allResellers.length;
  const pending = allResellers.filter(r => r.status === 'pending').length;
  const approved = allResellers.filter(r => r.status === 'approved').length;
  const suspended = allResellers.filter(r => r.status === 'suspended' || r.status === 'rejected').length;

  const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  el('statTotalResellers', total);
  el('statPendingResellers', pending);
  el('statApprovedResellers', approved);
  el('statSuspendedResellers', suspended);

  // Update badge in sidebar
  const badge = document.getElementById('pendingResellersBadge');
  if (badge) {
    if (pending > 0) {
      badge.textContent = pending;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }
}

function displayResellers(resellers) {
  const tbody = document.getElementById('resellersTableBody');
  if (!tbody) return;

  if (resellers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-light)">Aucun revendeur enregistré</td></tr>`;
    return;
  }

  tbody.innerHTML = resellers.map(r => {
    const status = r.status || 'pending';
    let statusBadge = '';
    if (status === 'pending') {
      statusBadge = `<span class="status-badge status-pending">⏳ En attente</span>`;
    } else if (status === 'approved') {
      statusBadge = `<span class="status-badge status-shipped">✓ Approuvé</span>`;
    } else if (status === 'suspended') {
      statusBadge = `<span class="status-badge status-returned">⛔ Suspendu</span>`;
    } else if (status === 'rejected') {
      statusBadge = `<span class="status-badge status-returned">✕ Rejeté</span>`;
    } else {
      statusBadge = `<span class="status-badge">${status}</span>`;
    }

    const dateStr = r.appliedAt ? new Date(r.appliedAt).toLocaleDateString('fr-FR') : (r.createdAt ? new Date(r.createdAt).toLocaleDateString('fr-FR') : '—');

    const resellerOrders = allCommandes.filter(cmd => (cmd.phone1 && cmd.phone1 === r.phone) || (cmd.customerId && cmd.customerId === r.id));
    const orderCount = resellerOrders.length;
    const totalSpent = resellerOrders.reduce((sum, cmd) => sum + (Number(cmd.grandTotal) || 0), 0);
    const purchasesHtml = orderCount > 0
      ? `<span style="font-weight:700; color:var(--primary);">${orderCount} achat${orderCount > 1 ? 's' : ''}</span><div style="font-size:0.75rem; color:var(--text-light);">${totalSpent.toFixed(2)} DA</div>`
      : `<span style="color:var(--text-light); font-size:0.8rem;">0 achat</span>`;

    return `
      <tr>
        <td style="font-weight:600;">${r.fullName || (r.firstName + ' ' + r.lastName)}</td>
        <td><a href="tel:${r.phone}" style="color:var(--primary); font-weight:600;">${r.phone || '—'}</a></td>
        <td>${r.wilaya || '—'} ${r.commune ? '• ' + r.commune : ''}</td>
        <td>${r.businessName ? `<strong>${r.businessName}</strong>` : '<span style="color:var(--text-light)">—</span>'}</td>
        <td>${purchasesHtml}</td>
        <td>${dateStr}</td>
        <td>${statusBadge}</td>
        <td>
          <button onclick="showCustomerDetail('${r.id}')" style="padding:6px 12px; background:var(--primary); color:#000; border:none; border-radius:4px; cursor:pointer; font-weight:600;">Gérer</button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterResellers() {
  const search = document.getElementById('searchResellersInput')?.value.toLowerCase() || '';
  const status = document.getElementById('filterResellersStatus')?.value || 'all';

  const filtered = allResellers.filter(r => {
    const nameMatch = (r.fullName || `${r.firstName} ${r.lastName}`).toLowerCase().includes(search) ||
      (r.phone && r.phone.includes(search)) ||
      (r.businessName && r.businessName.toLowerCase().includes(search)) ||
      (r.wilaya && r.wilaya.toLowerCase().includes(search));

    const statusMatch = (status === 'all') || (r.status === status);
    return nameMatch && statusMatch;
  });

  displayResellers(filtered);
}

// ==========================================
// 👥 CUSTOMER MANAGEMENT (REQUIREMENT 7)
// ==========================================

export function loadCustomers() {
  const tbody = document.getElementById('customersTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px"><i class="fa-solid fa-circle-notch fa-spin"></i> Chargement des clients...</td></tr>`;

  const q = query(collection(db, "clients"), orderBy("createdAt", "desc"));

  onSnapshot(q, (snapshot) => {
    allCustomers = [];
    snapshot.forEach(docSnap => {
      allCustomers.push({ id: docSnap.id, ...docSnap.data() });
    });

    displayCustomers(allCustomers);
    updateCustomerStats();
  }, (err) => {
    console.error("Customers error:", err);
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--danger)">Erreur: ${err.message}</td></tr>`;
  });
}
window.loadCustomers = loadCustomers;

function updateCustomerStats() {
  const total = allCustomers.length;
  const regular = allCustomers.filter(c => c.role !== 'reseller').length;
  const reseller = allCustomers.filter(c => c.role === 'reseller').length;

  const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  el('statTotalCustomers', total);
  el('statRegularCustomers', regular);
  el('statResellerAccounts', reseller);
}

function displayCustomers(customers) {
  const tbody = document.getElementById('customersTableBody');
  if (!tbody) return;

  if (customers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-light)">Aucun compte client enregistré</td></tr>`;
    return;
  }

  tbody.innerHTML = customers.map(c => {
    const isReseller = c.role === 'reseller';
    const roleBadge = isReseller 
      ? `<span style="background:rgba(255,184,0,0.2);color:var(--primary);padding:4px 10px;border-radius:12px;font-weight:700;font-size:0.75rem;">REVENDEUR</span>`
      : `<span style="background:rgba(16,185,129,0.15);color:var(--success);padding:4px 10px;border-radius:12px;font-weight:700;font-size:0.75rem;">CLIENT</span>`;

    const statusBadge = c.status === 'suspended'
      ? `<span class="status-badge status-returned">Suspendu</span>`
      : (c.status === 'pending' ? `<span class="status-badge status-pending">En attente</span>` : `<span class="status-badge status-shipped">Actif</span>`);

    const dateStr = c.createdAt ? new Date(c.createdAt).toLocaleDateString('fr-FR') : '—';

    const customerOrders = allCommandes.filter(cmd => (cmd.phone1 && cmd.phone1 === c.phone) || (cmd.customerId && cmd.customerId === c.id));
    const orderCount = customerOrders.length;
    const totalSpent = customerOrders.reduce((sum, cmd) => sum + (Number(cmd.grandTotal) || 0), 0);
    const purchasesHtml = orderCount > 0
      ? `<span style="font-weight:700; color:var(--primary);">${orderCount} achat${orderCount > 1 ? 's' : ''}</span><div style="font-size:0.75rem; color:var(--text-light);">${totalSpent.toFixed(2)} DA</div>`
      : `<span style="color:var(--text-light); font-size:0.8rem;">0 achat</span>`;

    return `
      <tr>
        <td style="font-weight:600;">${c.firstName || ''} ${c.lastName || ''}</td>
        <td><a href="tel:${c.phone}" style="color:var(--primary);">${c.phone || '—'}</a></td>
        <td>${c.email || '<span style="color:var(--text-light)">—</span>'}</td>
        <td>${c.wilaya || '—'} ${c.commune ? '• ' + c.commune : ''}</td>
        <td>${roleBadge}</td>
        <td>${statusBadge}</td>
        <td>${purchasesHtml}</td>
        <td>${dateStr}</td>
        <td>
          <button onclick="showCustomerDetail('${c.id}')" style="padding:6px 12px; background:var(--primary); color:#000; border:none; border-radius:4px; cursor:pointer; font-weight:600;">Détails</button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterCustomers() {
  const search = document.getElementById('searchCustomersInput')?.value.toLowerCase() || '';
  const role = document.getElementById('filterCustomersRole')?.value || 'all';
  const status = document.getElementById('filterCustomersStatus')?.value || 'all';

  const filtered = allCustomers.filter(c => {
    const nameMatch = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase().includes(search) ||
      (c.phone && c.phone.includes(search)) ||
      (c.email && c.email.toLowerCase().includes(search));

    const roleMatch = (role === 'all') || (c.role === role);
    const statusMatch = (status === 'all') || (c.status === status);
    return nameMatch && roleMatch && statusMatch;
  });

  displayCustomers(filtered);
}

// ==========================================
// 📋 CUSTOMER / RESELLER DETAILS MODAL
// ==========================================

export async function showCustomerDetail(clientId) {
  let customer = allCustomers.find(c => c.id === clientId) || allResellers.find(r => r.id === clientId);

  if (!customer) {
    // Fetch directly from DB
    try {
      const snap = await getDoc(doc(db, "clients", clientId));
      if (snap.exists()) {
        customer = { id: snap.id, ...snap.data() };
      }
    } catch (e) {
      console.error(e);
    }
  }

  if (!customer) {
    showNotification('Compte introuvable', 'error');
    return;
  }

  currentSelectedCustomer = customer;

  document.getElementById('cdFullName').textContent = `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Sans nom';
  document.getElementById('cdClientId').textContent = customer.id;
  document.getElementById('cdPhone').textContent = customer.phone || '—';
  document.getElementById('cdPhone').href = customer.phone ? `tel:${customer.phone}` : '#';
  document.getElementById('cdEmail').textContent = customer.email || '—';
  document.getElementById('cdWilaya').textContent = customer.wilaya || '—';
  document.getElementById('cdCommune').textContent = customer.commune || '—';
  document.getElementById('cdBusinessName').textContent = customer.businessName || '—';
  document.getElementById('cdBusinessAddress').textContent = customer.businessAddress || '—';
  document.getElementById('cdNotes').textContent = customer.notes || '—';
  document.getElementById('cdCreatedAt').textContent = customer.createdAt ? formatDateTime(customer.createdAt) : (customer.appliedAt ? formatDateTime(customer.appliedAt) : '—');

  // Role badge
  const roleBadge = document.getElementById('cdRoleBadge');
  if (customer.role === 'reseller') {
    roleBadge.className = 'status-badge status-accepted';
    roleBadge.textContent = 'REVENDEUR';
  } else {
    roleBadge.className = 'status-badge status-shipped';
    roleBadge.textContent = 'CLIENT STANDARD';
  }

  // Status badge
  const statusBadge = document.getElementById('cdStatusBadge');
  statusBadge.className = 'status-badge ' + (customer.status === 'approved' ? 'status-shipped' : (customer.status === 'suspended' ? 'status-returned' : 'status-pending'));
  statusBadge.textContent = customer.status ? customer.status.toUpperCase() : 'ACTIF';

  // Dynamic Action Buttons
  const actionsContainer = document.getElementById('cdActionButtons');
  let buttonsHtml = '';

  if (customer.role === 'reseller') {
    if (customer.status === 'pending') {
      buttonsHtml += `
        <button class="btn btn-primary" onclick="approveReseller('${customer.id}')">
          <i class="fa-solid fa-check"></i> Approuver Candidature (Prix Gros)
        </button>
        <button class="btn btn-outline" style="color:var(--danger); border-color:var(--danger);" onclick="rejectReseller('${customer.id}')">
          <i class="fa-solid fa-xmark"></i> Rejeter
        </button>
      `;
    } else if (customer.status === 'approved') {
      buttonsHtml += `
        <button class="btn btn-outline" style="color:var(--warning); border-color:var(--warning);" onclick="suspendReseller('${customer.id}')">
          <i class="fa-solid fa-ban"></i> Suspendre Accès Gros
        </button>
        <button class="btn btn-outline" onclick="revokeResellerPrivilege('${customer.id}')">
          Rétrograder en Client
        </button>
      `;
    } else if (customer.status === 'suspended' || customer.status === 'rejected') {
      buttonsHtml += `
        <button class="btn btn-primary" onclick="reactivateReseller('${customer.id}')">
          <i class="fa-solid fa-circle-check"></i> Réactiver Compte Revendeur
        </button>
      `;
    }
  } else {
    // Regular customer
    if (customer.status === 'suspended') {
      buttonsHtml += `
        <button class="btn btn-primary" onclick="reactivateCustomer('${customer.id}')">
          <i class="fa-solid fa-circle-check"></i> Réactiver le Compte
        </button>
      `;
    } else {
      buttonsHtml += `
        <button class="btn btn-primary" onclick="grantResellerPrivilege('${customer.id}')">
          <i class="fa-solid fa-handshake"></i> Promouvoir en Revendeur Agréé
        </button>
        <button class="btn btn-outline" style="color:var(--warning); border-color:var(--warning);" onclick="suspendCustomer('${customer.id}')">
          <i class="fa-solid fa-ban"></i> Suspendre
        </button>
      `;
    }
  }

  actionsContainer.innerHTML = buttonsHtml;

  // Load customer orders
  loadCustomerOrdersInModal(customer.phone, customer.id);

  document.getElementById('customerDetailModal').classList.add('active');
}
window.showCustomerDetail = showCustomerDetail;

async function loadCustomerOrdersInModal(phone, customerId) {
  const container = document.getElementById('cdOrdersContainer');
  const summaryBadge = document.getElementById('cdOrdersSummaryBadge');
  if (!container) return;

  container.innerHTML = '<p style="text-align:center; color:var(--text-light); padding:15px;"><i class="fa-solid fa-circle-notch fa-spin"></i> Chargement des achats...</p>';

  try {
    const orders = allCommandes.filter(c => (c.phone1 && c.phone1 === phone) || (c.customerId && c.customerId === customerId));
    
    // Sort by date descending
    orders.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    const totalSpent = orders.reduce((sum, cmd) => sum + (Number(cmd.grandTotal) || 0), 0);
    
    if (summaryBadge) {
      summaryBadge.innerHTML = orders.length > 0 
        ? `<i class="fa-solid fa-chart-line"></i> ${orders.length} commande${orders.length > 1 ? 's' : ''} • Total : ${totalSpent.toFixed(2)} DA`
        : `0 commande enregistrée`;
    }

    if (orders.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; color:var(--text-light); padding:30px 15px;">
          <i class="fa-solid fa-box-open" style="font-size:2rem; margin-bottom:8px; opacity:0.5;"></i>
          <p>Aucun achat enregistré pour ce client pour le moment.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = orders.map(cmd => {
      const dateStr = cmd.date ? new Date(cmd.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
      const items = Array.isArray(cmd.cartItems) ? cmd.cartItems : [];

      const itemsHtml = items.map(item => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:5px 0; font-size:0.8rem; border-bottom:1px dashed rgba(255,255,255,0.07);">
          <div>
            <strong style="color:var(--text);">${item.name || 'Produit'}</strong>
            ${item.flavor ? `<span style="color:var(--text-light); margin-left:4px;">(${item.flavor})</span>` : ''}
            <span style="color:var(--text-light); margin-left:6px;">× ${item.quantity || 1}</span>
          </div>
          <div style="color:var(--primary); font-weight:600;">
            ${(Number(item.total || (item.price * item.quantity)) || 0).toFixed(2)} DA
          </div>
        </div>
      `).join('');

      return `
        <div style="background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:12px; margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
            <div>
              <strong style="color:var(--primary); font-size:0.95rem;">#${cmd.orderNumber || 'CMD'}</strong>
              <span style="color:var(--text-light); font-size:0.8rem; margin-left:8px;">${dateStr}</span>
              <span class="status-badge ${getStatusClass(cmd.status)}" style="margin-left:8px; font-size:0.7rem;">${getStatusLabel(cmd.status)}</span>
              ${cmd.isWholesaleOrder ? `<span style="background:rgba(255,184,0,0.2); color:var(--primary); padding:2px 6px; border-radius:4px; font-size:0.7rem; font-weight:700; margin-left:4px;">GROS</span>` : ''}
            </div>
            <div style="font-weight:800; color:var(--primary); font-size:1.05rem;">
              ${(Number(cmd.grandTotal) || 0).toFixed(2)} DA
            </div>
          </div>

          <!-- Liste des articles -->
          <div style="background:rgba(0,0,0,0.3); border-radius:6px; padding:8px 12px; margin:8px 0;">
            <div style="font-size:0.75rem; text-transform:uppercase; color:var(--text-light); margin-bottom:4px; font-weight:700;">
              Articles achetés (${items.length})
            </div>
            ${itemsHtml || '<span style="color:var(--text-light); font-size:0.8rem;">Détail articles non spécifié</span>'}
            <div style="display:flex; justify-content:space-between; margin-top:6px; padding-top:4px; border-top:1px solid rgba(255,255,255,0.05); font-size:0.75rem; color:var(--text-light);">
              <span>Livraison (${cmd.orderType === 'domicile' ? 'Domicile' : 'Stop Desk'} - ${cmd.wilaya || '—'}) :</span>
              <span>${(Number(cmd.shippingPrice) || 0).toFixed(2)} DA</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

  } catch (e) {
    console.error("Error loading modal customer orders:", e);
    container.innerHTML = '<p style="text-align:center; color:var(--danger); padding:10px;">Erreur chargement des achats</p>';
  }
}

// ==========================================
// ⚡ ADMINISTRATIVE ACTIONS ON CUSTOMERS
// ==========================================

export async function approveReseller(clientId) {
  try {
    await updateDoc(doc(db, "clients", clientId), {
      role: 'reseller',
      status: 'approved',
      approvedAt: new Date().toISOString()
    });

    await logAdminAction("APPROVE_RESELLER", "clients", clientId, { role: 'reseller', status: 'approved' });
    showNotification('✅ Candidature revendeur approuvée ! Prix de gros activés.', 'success');
    closeModal('customerDetailModal');
    loadResellers();
  } catch (err) {
    console.error(err);
    showNotification('❌ Erreur: ' + err.message, 'error');
  }
}
window.approveReseller = approveReseller;

export async function rejectReseller(clientId) {
  if (!confirm("Voulez-vous vraiment rejeter cette candidature ?")) return;
  try {
    await updateDoc(doc(db, "clients", clientId), {
      status: 'rejected',
      rejectedAt: new Date().toISOString()
    });

    await logAdminAction("REJECT_RESELLER", "clients", clientId, { status: 'rejected' });
    showNotification('Candidature rejetée.', 'info');
    closeModal('customerDetailModal');
    loadResellers();
  } catch (err) {
    console.error(err);
    showNotification('❌ Erreur: ' + err.message, 'error');
  }
}
window.rejectReseller = rejectReseller;

export async function suspendReseller(clientId) {
  if (!confirm("Suspendre ce revendeur ? Il perdra immédiatement l'accès aux prix de gros.")) return;
  try {
    await updateDoc(doc(db, "clients", clientId), {
      status: 'suspended',
      suspendedAt: new Date().toISOString()
    });

    await logAdminAction("SUSPEND_RESELLER", "clients", clientId, { status: 'suspended' });
    showNotification('⛔ Compte revendeur suspendu.', 'warning');
    closeModal('customerDetailModal');
    loadResellers();
  } catch (err) {
    console.error(err);
    showNotification('❌ Erreur: ' + err.message, 'error');
  }
}
window.suspendReseller = suspendReseller;

export async function reactivateReseller(clientId) {
  try {
    await updateDoc(doc(db, "clients", clientId), {
      role: 'reseller',
      status: 'approved',
      reactivatedAt: new Date().toISOString()
    });

    await logAdminAction("REACTIVATE_RESELLER", "clients", clientId, { status: 'approved' });
    showNotification('✓ Compte revendeur réactivé !', 'success');
    closeModal('customerDetailModal');
    loadResellers();
  } catch (err) {
    console.error(err);
    showNotification('❌ Erreur: ' + err.message, 'error');
  }
}
window.reactivateReseller = reactivateReseller;

export async function grantResellerPrivilege(clientId) {
  try {
    await updateDoc(doc(db, "clients", clientId), {
      role: 'reseller',
      status: 'approved',
      upgradedAt: new Date().toISOString()
    });

    await logAdminAction("GRANT_RESELLER_PRIVILEGE", "clients", clientId);
    showNotification('✓ Client promu en revendeur agréé !', 'success');
    closeModal('customerDetailModal');
    loadCustomers();
  } catch (err) {
    console.error(err);
    showNotification('❌ Erreur: ' + err.message, 'error');
  }
}
window.grantResellerPrivilege = grantResellerPrivilege;

export async function revokeResellerPrivilege(clientId) {
  if (!confirm("Rétrograder ce revendeur en client standard ?")) return;
  try {
    await updateDoc(doc(db, "clients", clientId), {
      role: 'customer',
      status: 'active',
      revokedAt: new Date().toISOString()
    });

    await logAdminAction("REVOKE_RESELLER_PRIVILEGE", "clients", clientId);
    showNotification('Statut revendeur révoqué.', 'info');
    closeModal('customerDetailModal');
    loadResellers();
  } catch (err) {
    console.error(err);
    showNotification('❌ Erreur: ' + err.message, 'error');
  }
}
window.revokeResellerPrivilege = revokeResellerPrivilege;

export async function suspendCustomer(clientId) {
  if (!confirm("Suspendre ce compte client ?")) return;
  try {
    await updateDoc(doc(db, "clients", clientId), {
      status: 'suspended',
      suspendedAt: new Date().toISOString()
    });

    await logAdminAction("SUSPEND_CUSTOMER", "clients", clientId);
    showNotification('Compte suspendu.', 'warning');
    closeModal('customerDetailModal');
    loadCustomers();
  } catch (err) {
    console.error(err);
    showNotification('❌ Erreur: ' + err.message, 'error');
  }
}
window.suspendCustomer = suspendCustomer;

export async function reactivateCustomer(clientId) {
  try {
    await updateDoc(doc(db, "clients", clientId), {
      status: 'active',
      reactivatedAt: new Date().toISOString()
    });

    await logAdminAction("REACTIVATE_CUSTOMER", "clients", clientId);
    showNotification('Compte réactivé !', 'success');
    closeModal('customerDetailModal');
    loadCustomers();
  } catch (err) {
    console.error(err);
    showNotification('❌ Erreur: ' + err.message, 'error');
  }
}
window.reactivateCustomer = reactivateCustomer;

export async function deleteCurrentCustomer() {
  if (!currentSelectedCustomer) return;
  const id = currentSelectedCustomer.id;
  const name = currentSelectedCustomer.fullName || currentSelectedCustomer.firstName;

  if (!confirm(`ATTENTION SÉCURITÉ : Êtes-vous ABSOLUMENT certain de vouloir supprimer définitivement le compte de "${name}" ?`)) return;

  try {
    await deleteDoc(doc(db, "clients", id));
    await logAdminAction("DELETE_CUSTOMER", "clients", id, { name, phone: currentSelectedCustomer.phone });
    showNotification('Compte supprimé avec succès.', 'success');
    closeModal('customerDetailModal');
    loadCustomers();
    loadResellers();
  } catch (err) {
    console.error(err);
    showNotification('❌ Erreur suppression: ' + err.message, 'error');
  }
}
window.deleteCurrentCustomer = deleteCurrentCustomer;

// ==========================================
// ✏️ EDIT CUSTOMER MODAL
// ==========================================

export function openEditCurrentCustomerModal() {
  if (!currentSelectedCustomer) return;
  const c = currentSelectedCustomer;

  document.getElementById('ecCustomerId').value = c.id;
  document.getElementById('ecFirstName').value = c.firstName || '';
  document.getElementById('ecLastName').value = c.lastName || '';
  document.getElementById('ecPhone').value = c.phone || '';
  document.getElementById('ecEmail').value = c.email || '';
  document.getElementById('ecWilaya').value = c.wilaya || '';
  document.getElementById('ecCommune').value = c.commune || '';
  document.getElementById('ecRole').value = c.role || 'customer';
  document.getElementById('ecStatus').value = c.status || 'active';
  document.getElementById('ecBusinessName').value = c.businessName || '';
  document.getElementById('ecBusinessAddress').value = c.businessAddress || '';
  document.getElementById('ecNotes').value = c.notes || '';

  closeModal('customerDetailModal');
  document.getElementById('editCustomerModal').classList.add('active');
}
window.openEditCurrentCustomerModal = openEditCurrentCustomerModal;

document.getElementById('editCustomerForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('ecCustomerId').value;
  if (!id) return;

  const updates = {
    firstName: document.getElementById('ecFirstName').value.trim(),
    lastName: document.getElementById('ecLastName').value.trim(),
    fullName: `${document.getElementById('ecFirstName').value.trim()} ${document.getElementById('ecLastName').value.trim()}`,
    phone: document.getElementById('ecPhone').value.trim(),
    email: document.getElementById('ecEmail').value.trim(),
    wilaya: document.getElementById('ecWilaya').value.trim(),
    commune: document.getElementById('ecCommune').value.trim(),
    role: document.getElementById('ecRole').value,
    status: document.getElementById('ecStatus').value,
    businessName: document.getElementById('ecBusinessName').value.trim(),
    businessAddress: document.getElementById('ecBusinessAddress').value.trim(),
    notes: document.getElementById('ecNotes').value.trim(),
    updatedAt: new Date().toISOString()
  };

  try {
    await updateDoc(doc(db, "clients", id), updates);
    await logAdminAction("UPDATE_CUSTOMER_INFO", "clients", id, updates);
    showNotification('✓ Compte mis à jour avec succès !', 'success');
    closeModal('editCustomerModal');
    loadCustomers();
    loadResellers();
  } catch (err) {
    console.error(err);
    showNotification('❌ Erreur: ' + err.message, 'error');
  }
});

// ==========================================
// 🛡️ AUDIT LOGGING & SYSTEM MAINTENANCE
// ==========================================

export function loadAuditLogs() {
  const tbody = document.getElementById('auditTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px"><i class="fa-solid fa-circle-notch fa-spin"></i> Chargement de l'audit...</td></tr>`;

  const q = query(collection(db, "audit_logs"), orderBy("timestamp", "desc"));

  onSnapshot(q, (snapshot) => {
    allAuditLogs = [];
    snapshot.forEach(docSnap => {
      allAuditLogs.push({ id: docSnap.id, ...docSnap.data() });
    });

    if (allAuditLogs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-light)">Aucun enregistrement d'audit pour l'instant</td></tr>`;
      return;
    }

    tbody.innerHTML = allAuditLogs.map(log => {
      const detailsStr = log.details ? JSON.stringify(log.details) : '—';
      const adminDisplayName = (log.adminUser && log.adminUser.toLowerCase().includes('wahbi')) ? 'Hakim' : (log.adminUser || 'Hakim');
      return `
        <tr>
          <td>${formatDateTime(log.timestamp)}</td>
          <td><span style="font-weight:600; color:var(--primary);">${adminDisplayName}</span></td>
          <td><span class="status-badge status-accepted" style="font-size:0.75rem;">${log.action}</span></td>
          <td>${log.targetType || '—'}</td>
          <td><code>${log.targetId || '—'}</code></td>
          <td style="max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${detailsStr}">${detailsStr}</td>
        </tr>
      `;
    }).join('');
  }, (err) => {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--danger)">Erreur: ${err.message}</td></tr>`;
  });
}
window.loadAuditLogs = loadAuditLogs;

// Attach backup and migration buttons
document.getElementById('btnBackupDb')?.addEventListener('click', async () => {
  try {
    showNotification('💾 Préparation de la sauvegarde...', 'info');
    await backupDatabase();
    showNotification('✅ Sauvegarde téléchargée avec succès !', 'success');
  } catch (err) {
    showNotification('❌ Erreur sauvegarde: ' + err.message, 'error');
  }
});

document.getElementById('btnMigrateSchema')?.addEventListener('click', async () => {
  if (!confirm("Exécuter la migration du schéma des produits pour ajouter les champs Prix Revendeur ?")) return;
  try {
    showNotification('🔄 Migration du schéma en cours...', 'info');
    const result = await migrateProductsSchema();
    showNotification(`✅ Migration terminée ! ${result.updatedCount} produits mis à niveau.`, 'success');
  } catch (err) {
    showNotification('❌ Erreur migration: ' + err.message, 'error');
  }
});

// ==========================================
// 🖼️ IMAGE UPLOAD & ADD PRODUCT FORM
// ==========================================

let imageMode = 'url';

function setupImageUploadUI() {
  const modeUrlBtn = document.getElementById('imageModeUrl');
  const modeUploadBtn = document.getElementById('imageModeUpload');
  const urlContainer = document.getElementById('imageModeUrlContainer');
  const uploadContainer = document.getElementById('imageModeUploadContainer');
  const urlInput = document.getElementById('productImage');
  const fileInput = document.getElementById('productImageFile');
  const previewContainer = document.getElementById('imagePreview');
  const previewImg = document.getElementById('previewImg');
  const finalImageInput = document.getElementById('productImageFinal');

  if (!modeUrlBtn || !urlContainer) return;

  modeUrlBtn.addEventListener('click', () => {
    imageMode = 'url';
    modeUrlBtn.className = 'btn btn-primary';
    modeUploadBtn.className = 'btn btn-outline';
    urlContainer.style.display = 'block';
    uploadContainer.style.display = 'none';
    if (urlInput && finalImageInput) finalImageInput.value = urlInput.value;
  });

  modeUploadBtn.addEventListener('click', () => {
    imageMode = 'upload';
    modeUploadBtn.className = 'btn btn-primary';
    modeUrlBtn.className = 'btn btn-outline';
    urlContainer.style.display = 'none';
    uploadContainer.style.display = 'block';
  });

  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && previewImg && previewContainer) {
      const reader = new FileReader();
      reader.onload = (event) => {
        previewImg.src = event.target.result;
        previewContainer.style.display = 'block';
      };
      reader.readAsDataURL(file);
    } else if (previewContainer) {
      previewContainer.style.display = 'none';
    }
  });

  urlInput?.addEventListener('input', () => {
    if (imageMode === 'url' && finalImageInput) finalImageInput.value = urlInput.value;
  });
}

document.getElementById('addProductForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const submitBtn = document.getElementById('addProductSubmitBtn');
  const originalBtnText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Traitement...';

  try {
    const name = document.getElementById('productName')?.value.trim();
    const category = document.getElementById('productCategory')?.value;
    const description = document.getElementById('productDescription')?.value.trim();
    const quantity = parseInt(document.getElementById('productQuantity')?.value) || 0;
    const price = parseFloat(document.getElementById('productPrice')?.value);

    // Wholesale Price & Enabled Status
    const reseller_price = parseFloat(document.getElementById('productResellerPrice')?.value) || 0;
    const reseller_pricing_enabled = document.getElementById('productResellerPricingEnabled')?.checked || false;

    let imageUrl = '';
    if (imageMode === 'upload') {
      const file = document.getElementById('productImageFile')?.files[0];
      if (file) {
        const { uploadImage } = await import('./db-service.js');
        showNotification('📤 Upload image principale...', 'info');
        imageUrl = await uploadImage(file);
      }
    } else {
      imageUrl = sanitizeImageUrl(document.getElementById('productImage')?.value.trim());
    }

    if (!name || !imageUrl || !category || isNaN(price) || price <= 0) {
      throw new Error('Veuillez remplir tous les champs obligatoires');
    }

    // Flavors
    const flavors = [];
    const { uploadImage } = await import('./db-service.js');
    const flavorItems = document.querySelectorAll('.flavor-field');

    for (const item of flavorItems) {
      const fNameInput = item.querySelector('input[name^="flavorName"]');
      const fUrlInput = item.querySelector('input[name^="flavorImage"]');
      const fName = fNameInput?.value.trim();
      const fUrl = fUrlInput?.value.trim();
      if (fName) {
        flavors.push({ name: fName, image: sanitizeImageUrl(fUrl) || imageUrl });
      }
    }

    // Ingredients
    const ingredients = [];
    const ingredientItems = document.querySelectorAll('#ingredientsList .ingredient-item');
    for (const item of ingredientItems) {
      const ingName = item.querySelector('.ingredient-name')?.value.trim();
      const ingValue = item.querySelector('.ingredient-value')?.value;
      const ingUnit = item.querySelector('.ingredient-unit')?.value || 'g';
      if (ingName && ingValue !== '' && !isNaN(parseFloat(ingValue))) {
        ingredients.push({ name: ingName, value: parseFloat(ingValue), unit: ingUnit });
      }
    }

    const { addProduct } = await import('./db-service.js');
    await addProduct({
      name,
      image: imageUrl,
      category,
      description: description || '',
      price,
      reseller_price,
      reseller_pricing_enabled,
      quantity,
      flavors,
      ingredients,
      dateAdded: new Date().toISOString()
    });

    await logAdminAction("ADD_PRODUCT", "produits", name, { price, reseller_price, reseller_pricing_enabled });
    showNotification('✅ Produit ajouté avec succès !', 'success');
    closeAddProductModal();
    e.target.reset();
    resetProductForm();

  } catch (error) {
    console.error("❌ Erreur ajout produit:", error);
    showNotification('❌ ' + (error.message || "Erreur lors de l'ajout"), 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalBtnText;
  }
});

// ==========================================
// 📌 UTILITIES & INIT
// ==========================================

function showNotification(msg, type = 'success') {
  if (typeof window.showToast === 'function') {
    window.showToast(msg, type);
    return;
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${msg}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadCommandes();
  setupImageUploadUI();

  // Search & filter listeners
  document.getElementById('searchInput')?.addEventListener('input', filterCommandes);
  document.getElementById('filterType')?.addEventListener('change', filterCommandes);
  document.getElementById('filterWilaya')?.addEventListener('change', filterCommandes);

  document.getElementById('searchResellersInput')?.addEventListener('input', filterResellers);
  document.getElementById('filterResellersStatus')?.addEventListener('change', filterResellers);

  document.getElementById('searchCustomersInput')?.addEventListener('input', filterCustomers);
  document.getElementById('filterCustomersRole')?.addEventListener('change', filterCustomers);
  document.getElementById('filterCustomersStatus')?.addEventListener('change', filterCustomers);

  // Initial tab from URL hash if present
  const hash = window.location.hash.replace('#', '');
  if (hash && ['commandes', 'resellers', 'customers', 'shipping', 'audit'].includes(hash)) {
    switchAdminTab(hash);
  }

  window.addEventListener('hashchange', () => {
    const newHash = window.location.hash.replace('#', '');
    if (newHash && ['commandes', 'resellers', 'customers', 'shipping', 'audit'].includes(newHash)) {
      switchAdminTab(newHash);
    }
  });
});

// ==========================================
// 🚚 GESTION DES TARIFS DE LIVRAISON PAR WILAYA
// ==========================================

let currentDomicileRates = {};
let currentStopDeskRates = {};

export async function loadShippingAdmin() {
  const tbody = document.getElementById('shippingTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text-light);"><i class="fa-solid fa-circle-notch fa-spin"></i> Chargement des tarifs de livraison...</td></tr>`;

  try {
    const rates = await fetchLiveShippingRates(db);
    currentDomicileRates = { ...rates.domicile };
    currentStopDeskRates = { ...rates.stopdesk };

    renderShippingTable(Object.keys(DEFAULT_SHIPPING_PRICES));
  } catch (err) {
    console.error("Erreur chargement tarifs livraison:", err);
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--danger);">Erreur de chargement des tarifs</td></tr>`;
  }
}
window.loadShippingAdmin = loadShippingAdmin;

export function renderShippingTable(wilayasList) {
  const tbody = document.getElementById('shippingTableBody');
  if (!tbody) return;

  if (wilayasList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-light);">Aucune wilaya trouvée pour cette recherche</td></tr>`;
    return;
  }

  tbody.innerHTML = wilayasList.map(key => {
    const code = key.split(' - ')[0] || '';
    const name = key.split(' - ')[1] || key;
    const domPrice = currentDomicileRates[key] !== undefined ? currentDomicileRates[key] : (DEFAULT_SHIPPING_PRICES[key] || 0);
    const stopPrice = currentStopDeskRates[key] !== undefined ? currentStopDeskRates[key] : (DEFAULT_STOPDESK_PRICES[key] || 0);
    const safeKey = key.replace(/[^a-zA-Z0-9]/g, '_');

    return `
      <tr>
        <td style="font-weight:700; color:var(--primary); font-size:1rem;">${code}</td>
        <td style="font-weight:600; font-size:0.95rem;">${name}</td>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <input type="number" id="rate_dom_${safeKey}" value="${domPrice}" min="0" step="50" class="form-control" style="width:130px; padding:8px 12px; background:var(--bg); border:1px solid var(--border); color:#fff; border-radius:var(--radius); font-weight:700;">
            <span style="color:var(--text-light); font-size:0.85rem;">DA</span>
          </div>
        </td>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <input type="number" id="rate_stop_${safeKey}" value="${stopPrice}" min="0" step="50" class="form-control" style="width:130px; padding:8px 12px; background:var(--bg); border:1px solid var(--border); color:#fff; border-radius:var(--radius); font-weight:700;">
            <span style="color:var(--text-light); font-size:0.85rem;">DA</span>
          </div>
        </td>
        <td style="text-align:center;">
          <button class="btn btn-outline" style="padding:6px 12px; font-size:0.8rem;" onclick="saveSingleWilayaRate('${key}', '${safeKey}')">
            <i class="fa-solid fa-floppy-disk"></i> Enregistrer
          </button>
        </td>
      </tr>
    `;
  }).join('');
}
window.renderShippingTable = renderShippingTable;

export function filterShippingWilayas() {
  const queryStr = document.getElementById('searchWilayaShippingInput')?.value.trim().toLowerCase() || '';
  const allKeys = Object.keys(DEFAULT_SHIPPING_PRICES);

  if (!queryStr) {
    renderShippingTable(allKeys);
    return;
  }

  const filtered = allKeys.filter(k => k.toLowerCase().includes(queryStr));
  renderShippingTable(filtered);
}
window.filterShippingWilayas = filterShippingWilayas;

export async function saveSingleWilayaRate(wilayaKey, safeKey) {
  const domInput = document.getElementById(`rate_dom_${safeKey}`);
  const stopInput = document.getElementById(`rate_stop_${safeKey}`);
  if (!domInput || !stopInput) return;

  const domVal = parseFloat(domInput.value) || 0;
  const stopVal = parseFloat(stopInput.value) || 0;

  currentDomicileRates[wilayaKey] = domVal;
  currentStopDeskRates[wilayaKey] = stopVal;

  try {
    await saveShippingRatesToFirestore(db, currentDomicileRates, currentStopDeskRates);
    await logAdminAction("UPDATE_SHIPPING_RATE_WILAYA", "parametres", "livraison", { wilaya: wilayaKey, domicile: domVal, stopdesk: stopVal });
    showNotification(`✅ Tarifs enregistrés pour ${wilayaKey} : Domicile ${domVal} DA / Stop Desk ${stopVal} DA`, 'success');
  } catch (err) {
    console.error(err);
    showNotification(`❌ Erreur: ${err.message}`, 'error');
  }
}
window.saveSingleWilayaRate = saveSingleWilayaRate;

export async function saveAllShippingPrices() {
  const saveBtn = document.getElementById('saveAllShippingBtn');
  const originalHTML = saveBtn ? saveBtn.innerHTML : '';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Enregistrement en cours...';
  }

  try {
    const allKeys = Object.keys(DEFAULT_SHIPPING_PRICES);
    for (const key of allKeys) {
      const safeKey = key.replace(/[^a-zA-Z0-9]/g, '_');
      const domInput = document.getElementById(`rate_dom_${safeKey}`);
      const stopInput = document.getElementById(`rate_stop_${safeKey}`);
      if (domInput) currentDomicileRates[key] = parseFloat(domInput.value) || 0;
      if (stopInput) currentStopDeskRates[key] = parseFloat(stopInput.value) || 0;
    }

    await saveShippingRatesToFirestore(db, currentDomicileRates, currentStopDeskRates);
    await logAdminAction("UPDATE_ALL_SHIPPING_RATES", "parametres", "livraison", { count: allKeys.length });

    showNotification('🎉 Tous les tarifs de livraison des 58 wilayas ont été enregistrés avec succès !', 'success');
  } catch (err) {
    console.error(err);
    showNotification(`❌ Erreur lors de l'enregistrement: ${err.message}`, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalHTML;
    }
  }
}
window.saveAllShippingPrices = saveAllShippingPrices;

export async function resetDefaultShippingPrices() {
  if (!confirm("Voulez-vous vraiment rétablir les tarifs de livraison par défaut pour les 58 wilayas ?")) return;

  currentDomicileRates = { ...DEFAULT_SHIPPING_PRICES };
  currentStopDeskRates = { ...DEFAULT_STOPDESK_PRICES };

  try {
    await saveShippingRatesToFirestore(db, currentDomicileRates, currentStopDeskRates);
    await logAdminAction("RESET_DEFAULT_SHIPPING_RATES", "parametres", "livraison", {});
    renderShippingTable(Object.keys(DEFAULT_SHIPPING_PRICES));
    showNotification('✅ Tarifs de livraison par défaut rétablis avec succès !', 'success');
  } catch (err) {
    console.error(err);
    showNotification(`❌ Erreur: ${err.message}`, 'error');
  }
}
window.resetDefaultShippingPrices = resetDefaultShippingPrices;

// Global exports
window.showDetail = showDetail;
window.closeDetail = closeDetail;
window.confirmStatusUpdate = confirmStatusUpdate;
window.deleteCommande = deleteCommande;
window.filterCommandes = filterCommandes;
window.clearFilters = clearFilters;
window.exportCommandes = exportCommandes;
