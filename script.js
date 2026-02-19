// =============== COPY DARI SINI ===============
const SUPABASE_URL = 'https://aetnuvotehpbfykakuni.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFldG51dm90ZWhwYmZ5a2FrdW5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwNTU0OTgsImV4cCI6MjA4NDYzMTQ5OH0.VurModFLejJ-f68RqwpydgrrvCJ84zoNftugg-8SS9k';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Default Config
const defaultConfig = {
  app_title: 'BRFT MONITORING SYSTEM PRODUCTION',
  company_name: 'Created by MSTD',
  primary_color: '#10b981',
  background_color: '#111827',
  surface_color: '#1f2937',
  text_color: '#f3f4f6',
  accent_color: '#059669'
};

// Application State
let findings = [];
let operators = [];
let products = [];
let areas = [];
let categories = [];
let targets = [];
let auditLogs = [];
let isAdminLoggedIn = false;
let deleteCallback = null;
let editCallback = null;
let charts = {};
let currentFilteredFindings = [];

// Supabase Real-time Subscriptions
let subscriptions = [];

// Initialize Element SDK
if (window.elementSdk) {
  window.elementSdk.init({
    defaultConfig,
    onConfigChange: async (config) => {
      document.getElementById('app-title').textContent = config.app_title || defaultConfig.app_title;
      document.getElementById('company-name').textContent = config.company_name || defaultConfig.company_name;
    },
    mapToCapabilities: (config) => ({
      recolorables: [
        {
          get: () => config.primary_color || defaultConfig.primary_color,
          set: (v) => { config.primary_color = v; window.elementSdk.setConfig({ primary_color: v }); }
        }
      ],
      borderables: [],
      fontEditable: undefined,
      fontSizeable: undefined
    }),
    mapToEditPanelValues: (config) => new Map([
      ['app_title', config.app_title || defaultConfig.app_title],
      ['company_name', config.company_name || defaultConfig.company_name]
    ])
  });
}

// Supabase Data Loading Functions
async function loadAllData() {
  try {
    const [operatorsRes, productsRes, areasRes, categoriesRes, targetsRes, findingsRes, auditRes] = await Promise.all([
      supabaseClient.from('operators').select('*').order('name'),
      supabaseClient.from('products').select('*').order('name'),
      supabaseClient.from('areas').select('*').order('name'),
      supabaseClient.from('categories').select('*').order('name'),
      supabaseClient.from('targets').select('*').order('target_month', { ascending: false }),
      supabaseClient.from('findings_detailed').select('*').order('date', { ascending: false }),
      supabaseClient.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(500)
    ]);

    if (operatorsRes.error) throw operatorsRes.error;
    if (productsRes.error) throw productsRes.error;
    if (areasRes.error) throw areasRes.error;
    if (categoriesRes.error) throw categoriesRes.error;
    if (targetsRes.error) throw targetsRes.error;
    if (findingsRes.error) throw findingsRes.error;
    if (auditRes.error) throw auditRes.error;

    operators = operatorsRes.data || [];
    products = productsRes.data || [];
    areas = areasRes.data || [];
    categories = categoriesRes.data || [];
    targets = targetsRes.data || [];
    findings = findingsRes.data || [];
    auditLogs = auditRes.data || [];

    updateDropdowns();
    updateDashboard();
    updateManagementLists();
    updateAuditTable();
    
    // Update semua tabel tren
    updateAllTrendTables();
  } catch (error) {
    console.error('Error loading data:', error);
    showToast('GAGAL MEMUAT DATA', 'error');
  }
}

// Setup Real-time Subscriptions
function setupRealtimeSubscriptions() {
  const tables = ['operators', 'products', 'areas', 'categories', 'targets', 'findings', 'audit_logs'];
  
  tables.forEach(table => {
    const subscription = supabaseClient
      .channel(`public:${table}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: table 
      }, async (payload) => {
        console.log(`✅ Real-time update detected on ${table}:`, payload.eventType);
        await loadAllData();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`✅ Subscribed to ${table} changes`);
        } else {
          console.log(`⚠️ Subscription status for ${table}:`, status);
        }
      });
    
    subscriptions.push(subscription);
  });
}

// Toast Notification
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'success' ? 'bg-emerald-600' : type === 'error' ? 'bg-red-600' : 'bg-blue-600'} text-white`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Add Audit Log
async function addAuditLog(action, details, area = '', product = '', category = '', initial = '') {
  try {
    const { error } = await supabaseClient.from('audit_logs').insert({
      action: action,
      details: details,
      area: area || null,
      product: product || null,
      category: category || null,
      operator_initial: initial || null
    });
    
    if (error) throw error;
  } catch (error) {
    console.error('Error adding audit log:', error);
  }
}

// =============== FUNGSI GENERIK UNTUK TREND TABLES ===============

function generateTrendTable(data, type, limit = 8) {
  // data: array of findings
  // type: 'area', 'product', 'operator', 'category'
  if (!data || data.length === 0) {
    return { header: '<th class="p-4 text-center text-gray-400" colspan="2">BELUM ADA DATA</th>', body: '' };
  }

  // Tentukan field name dan label
  let nameField, nameLabel, badgeClass;
  switch(type) {
    case 'area':
      nameField = 'area';
      nameLabel = 'AREA';
      badgeClass = 'area-badge';
      break;
    case 'product':
      nameField = 'product_code';
      nameLabel = 'PRODUK';
      badgeClass = 'product-badge';
      break;
    case 'operator':
      nameField = 'operator_initial';
      nameLabel = 'OPERATOR';
      badgeClass = 'operator-badge';
      limit = 10; // Operator bisa lebih banyak
      break;
    case 'category':
      nameField = 'category';
      nameLabel = 'KATEGORI';
      badgeClass = 'category-badge';
      break;
    default:
      return { header: '', body: '' };
  }

  // Kumpulkan data per item per bulan
  const itemMonthlyData = {};
  const monthsSet = new Set();
  
  data.forEach(f => {
    if (f.date && f[nameField]) {
      const month = f.date.substring(0, 7); // YYYY-MM
      monthsSet.add(month);
      
      if (!itemMonthlyData[f[nameField]]) {
        itemMonthlyData[f[nameField]] = {};
      }
      
      itemMonthlyData[f[nameField]][month] = 
        (itemMonthlyData[f[nameField]][month] || 0) + 1;
    }
  });

  // Urutkan bulan dari terlama ke terbaru
  const sortedMonths = Array.from(monthsSet).sort();
  
  // Hitung total temuan per item dan ambil TOP N
  const itemTotals = Object.keys(itemMonthlyData).map(item => ({
    name: item,
    total: Object.values(itemMonthlyData[item]).reduce((sum, val) => sum + val, 0)
  }));
  
  itemTotals.sort((a, b) => b.total - a.total);
  const topItems = itemTotals.slice(0, limit).map(item => item.name);

  // Jika tidak ada item, tampilkan pesan
  if (topItems.length === 0) {
    return { header: '<th class="p-4 text-center text-gray-400" colspan="2">BELUM ADA DATA</th>', body: '' };
  }

  // ===== BUILD TABLE HEADER =====
  let headerHTML = `<th class="sticky left-0 bg-gray-700 text-left" style="min-width:120px;">${nameLabel}</th>`;
  
  // Format bulan menjadi NAMA BULAN
  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  
  sortedMonths.forEach(month => {
    const [year, monthNum] = month.split('-');
    const monthName = monthNames[parseInt(monthNum) - 1];
    headerHTML += `<th style="min-width:70px;">${monthName}<br><span class="text-xs text-gray-400">${year}</span></th>`;
  });
  
  headerHTML += '<th style="min-width:80px; background-color:#4b5563;">TOTAL</th>';

  // ===== BUILD TABLE BODY =====
  let bodyHTML = '';
  
  topItems.forEach(item => {
    let rowHTML = `<tr><td class="sticky left-0 bg-gray-800 font-bold text-left"><span class="item-badge ${badgeClass}">${item}</span></td>`;
    
    let itemTotal = 0;
    
    sortedMonths.forEach(month => {
      const count = itemMonthlyData[item]?.[month] || 0;
      itemTotal += count;
      
      // Warna background berdasarkan jumlah temuan
      let bgColor = 'bg-gray-800';
      if (count > 0) {
        if (count >= 5) bgColor = 'bg-red-900/60';
        else if (count >= 3) bgColor = 'bg-orange-900/50';
        else if (count >= 1) bgColor = 'bg-yellow-900/40';
      }
      
      rowHTML += `<td class="${bgColor} font-mono">${count || '-'}</td>`;
    });
    
    // Kolom total
    rowHTML += `<td class="bg-blue-900/40 font-bold">${itemTotal}</td>`;
    rowHTML += '</tr>';
    
    bodyHTML += rowHTML;
  });

  // Tambahkan baris TOTAL KESELURUHAN
  let totalRowHTML = '<tr class="border-t-2 border-gray-600 bg-gray-700/50"><td class="sticky left-0 bg-gray-700 font-bold">TOTAL</td>';
  
  sortedMonths.forEach(month => {
    let monthTotal = 0;
    topItems.forEach(item => {
      monthTotal += itemMonthlyData[item]?.[month] || 0;
    });
    totalRowHTML += `<td class="font-bold">${monthTotal || '-'}</td>`;
  });
  
  // Total keseluruhan
  let grandTotal = 0;
  topItems.forEach(item => {
    grandTotal += itemTotals.find(i => i.name === item)?.total || 0;
  });
  totalRowHTML += `<td class="bg-blue-800/60 font-bold">${grandTotal}</td>`;
  totalRowHTML += '</tr>';
  
  bodyHTML += totalRowHTML;
  
  return { header: headerHTML, body: bodyHTML };
}

// Update semua trend tables
function updateAllTrendTables() {
  // Gunakan semua findings (tidak terfilter) untuk tren historis
  
  // AREA
  const areaTrend = generateTrendTable(findings, 'area', 8);
  document.getElementById('trend-table-header-area').innerHTML = areaTrend.header;
  document.getElementById('trend-table-body-area').innerHTML = areaTrend.body;
  
  // PRODUCT
  const productTrend = generateTrendTable(findings, 'product', 8);
  document.getElementById('trend-table-header-product').innerHTML = productTrend.header;
  document.getElementById('trend-table-body-product').innerHTML = productTrend.body;
  
  // OPERATOR
  const operatorTrend = generateTrendTable(findings, 'operator', 10);
  document.getElementById('trend-table-header-operator').innerHTML = operatorTrend.header;
  document.getElementById('trend-table-body-operator').innerHTML = operatorTrend.body;
  
  // CATEGORY
  const categoryTrend = generateTrendTable(findings, 'category', 8);
  document.getElementById('trend-table-header-category').innerHTML = categoryTrend.header;
  document.getElementById('trend-table-body-category').innerHTML = categoryTrend.body;
}

// Tab Navigation
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab !== 'management' && isAdminLoggedIn) {
      isAdminLoggedIn = false;
      document.getElementById('admin-panel').classList.add('hidden');
      document.getElementById('admin-login').classList.remove('hidden');
      document.getElementById('admin-password').value = '';
    }

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-active', 'text-emerald-400'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.add('text-gray-400'));
    btn.classList.add('tab-active', 'text-emerald-400');
    btn.classList.remove('text-gray-400');

    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.getElementById(`${btn.dataset.tab}-tab`).classList.remove('hidden');
  });
});

// Management Sub-tabs
document.querySelectorAll('.mgmt-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.mgmt-tab').forEach(t => {
      t.classList.remove('mgmt-tab-active', 'border-emerald-500', 'text-emerald-400', 'border-b-2');
      t.classList.add('text-gray-400');
    });
    tab.classList.add('mgmt-tab-active', 'border-emerald-500', 'text-emerald-400', 'border-b-2');
    tab.classList.remove('text-gray-400');

    document.querySelectorAll('.mgmt-content').forEach(c => c.classList.add('hidden'));
    document.getElementById(`mgmt-${tab.dataset.mgmt}`).classList.remove('hidden');
  });
});

// Multi-select filter state
const selectedFilters = {
  areas: new Set(),
  products: new Set(),
  categories: new Set(),
  operators: new Set()
};

// Update Dropdowns
function updateDropdowns() {
  const areaOptions = '<option value="">PILIH AREA</option>' + areas.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
  const categoryOptions = '<option value="">PILIH KATEGORI</option>' + categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const productOptions = '<option value="">PILIH PRODUK</option>' + products.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  const operatorOptions = '<option value="">PILIH OPERATOR</option>' + operators.map(o => `<option value="${o.id}">${o.name}</option>`).join('');

  document.getElementById('input-area').innerHTML = areaOptions;
  document.getElementById('input-category').innerHTML = categoryOptions;
  document.getElementById('input-product').innerHTML = productOptions;
  document.getElementById('input-operator').innerHTML = operatorOptions;

  updateMultiSelectList('area', areas);
  updateMultiSelectList('product', products);
  updateMultiSelectList('category', categories);
  updateMultiSelectList('operator', operators);

  document.getElementById('audit-filter-area').innerHTML = '<option value="">SEMUA</option>' + areas.map(a => `<option value="${a.name}">${a.name}</option>`).join('');
  document.getElementById('audit-filter-product').innerHTML = '<option value="">SEMUA</option>' + products.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
  document.getElementById('audit-filter-category').innerHTML = '<option value="">SEMUA</option>' + categories.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  document.getElementById('audit-filter-initial').innerHTML = '<option value="">SEMUA</option>' + operators.map(o => `<option value="${o.name}">${o.name}</option>`).join('');
}

// Update multi-select checkbox list
function updateMultiSelectList(type, items) {
  const listEl = document.getElementById(`filter-${type}-list`);
  
  let filterKey;
  if (type === 'area') filterKey = 'areas';
  else if (type === 'product') filterKey = 'products';
  else if (type === 'category') filterKey = 'categories';
  else if (type === 'operator') filterKey = 'operators';
  
  listEl.innerHTML = items.map(item => `
    <label class="flex items-center gap-2 px-2 py-1 hover:bg-gray-600 rounded cursor-pointer">
      <input type="checkbox" class="filter-${type}-checkbox form-checkbox text-emerald-600 rounded" 
             value="${item.name}" ${selectedFilters[filterKey].has(item.name) ? 'checked' : ''}>
      <span class="text-sm">${item.name}</span>
    </label>
  `).join('');

  listEl.querySelectorAll(`.filter-${type}-checkbox`).forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        selectedFilters[filterKey].add(e.target.value);
      } else {
        selectedFilters[filterKey].delete(e.target.value);
      }
      updateMultiSelectLabel(type);
      
      const allCheckbox = document.getElementById(`filter-${type}-all`);
      allCheckbox.checked = selectedFilters[filterKey].size === items.length;
    });
  });
}

// Update multi-select label based on selected items
function updateMultiSelectLabel(type) {
  let filterKey;
  if (type === 'area') filterKey = 'areas';
  else if (type === 'product') filterKey = 'products';
  else if (type === 'category') filterKey = 'categories';
  else if (type === 'operator') filterKey = 'operators';
  
  const labelEl = document.getElementById(`filter-${type}-label`);
  const count = selectedFilters[filterKey].size;
  
  if (count === 0) {
    if (type === 'area') labelEl.textContent = 'SEMUA AREA';
    else if (type === 'product') labelEl.textContent = 'SEMUA PRODUK';
    else if (type === 'category') labelEl.textContent = 'SEMUA KATEGORI';
    else if (type === 'operator') labelEl.textContent = 'SEMUA OPERATOR';
  } else if (count === 1) {
    labelEl.textContent = Array.from(selectedFilters[filterKey])[0];
  } else {
    if (type === 'area') labelEl.textContent = `${count} AREA DIPILIH`;
    else if (type === 'product') labelEl.textContent = `${count} PRODUK DIPILIH`;
    else if (type === 'category') labelEl.textContent = `${count} KATEGORI DIPILIH`;
    else if (type === 'operator') labelEl.textContent = `${count} OPERATOR DIPILIH`;
  }
}

// Setup multi-select dropdown toggles
function setupMultiSelectDropdowns() {
  ['area', 'product', 'category', 'operator'].forEach(type => {
    const btn = document.getElementById(`filter-${type}-btn`);
    const dropdown = document.getElementById(`filter-${type}-dropdown`);
    const selectAllCheckbox = document.getElementById(`filter-${type}-all`);
    
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      ['area', 'product', 'category', 'operator'].forEach(t => {
        if (t !== type) {
          document.getElementById(`filter-${t}-dropdown`).classList.add('hidden');
        }
      });
      dropdown.classList.toggle('hidden');
    });

    selectAllCheckbox.addEventListener('change', (e) => {
      let filterKey;
      if (type === 'area') filterKey = 'areas';
      else if (type === 'product') filterKey = 'products';
      else if (type === 'category') filterKey = 'categories';
      else if (type === 'operator') filterKey = 'operators';
      
      const checkboxes = document.querySelectorAll(`.filter-${type}-checkbox`);
      
      if (e.target.checked) {
        checkboxes.forEach(cb => {
          cb.checked = true;
          selectedFilters[filterKey].add(cb.value);
        });
      } else {
        checkboxes.forEach(cb => {
          cb.checked = false;
          selectedFilters[filterKey].delete(cb.value);
        });
      }
      updateMultiSelectLabel(type);
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.multi-select-wrapper')) {
      ['area', 'product', 'category', 'operator'].forEach(type => {
        document.getElementById(`filter-${type}-dropdown`).classList.add('hidden');
      });
    }
  });
}

// Calculate BRFT Percentage
function calculateBRFT(month, targetValue, findingsCount) {
  if (!targetValue || targetValue <= 0) return null;
  return ((targetValue - findingsCount) / targetValue) * 100;
}

// Update Dashboard
function updateDashboard() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  currentFilteredFindings = [...findings];
  const dateFrom = document.getElementById('filter-date-from').value;
  const dateTo = document.getElementById('filter-date-to').value;

  if (dateFrom) currentFilteredFindings = currentFilteredFindings.filter(f => f.date >= dateFrom);
  if (dateTo) currentFilteredFindings = currentFilteredFindings.filter(f => f.date <= dateTo);
  
  if (selectedFilters.areas.size > 0) {
    currentFilteredFindings = currentFilteredFindings.filter(f => selectedFilters.areas.has(f.area_name));
  }
  if (selectedFilters.products.size > 0) {
    currentFilteredFindings = currentFilteredFindings.filter(f => selectedFilters.products.has(f.product_name));
  }
  if (selectedFilters.categories.size > 0) {
    currentFilteredFindings = currentFilteredFindings.filter(f => selectedFilters.categories.has(f.category_name));
  }
  if (selectedFilters.operators.size > 0) {
    currentFilteredFindings = currentFilteredFindings.filter(f => selectedFilters.operators.has(f.operator_name));
  }

  document.getElementById('total-findings').textContent = currentFilteredFindings.length;

  const uniqueBatches = new Set(currentFilteredFindings.map(f => f.batch_number).filter(b => b));
  document.getElementById('unique-batches').textContent = uniqueBatches.size;

  let targetValue = 0;
  let uniqueBatchesForBRFT = 0;
  let isValidForBRFT = false;
  let coveredMonths = [];

  if (dateFrom && dateTo) {
    const fromDate = new Date(dateFrom);
    const toDate = new Date(dateTo);
    
    let currentDate = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
    while (currentDate <= toDate) {
      const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
      const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const lastDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
      
      const firstDayStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-01`;
      const lastDayStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(lastDayOfMonth.getDate()).padStart(2, '0')}`;
      
      const isFullMonth = dateFrom <= firstDayStr && dateTo >= lastDayStr;
      
      if (isFullMonth && !coveredMonths.includes(monthKey)) {
        coveredMonths.push(monthKey);
      }
      
      currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
    }
    
    if (coveredMonths.length > 0) {
      isValidForBRFT = true;
      
      const uniqueBatchSet = new Set(currentFilteredFindings.map(f => f.batch_number).filter(b => b));
      uniqueBatchesForBRFT = uniqueBatchSet.size;
      
      coveredMonths.forEach(month => {
        const monthTarget = targets.find(t => t.target_month === month);
        if (monthTarget) {
          targetValue += monthTarget.target_value;
        }
      });
    }
  } else if (!dateFrom && !dateTo) {
    isValidForBRFT = true;
    
    const uniqueBatchSet = new Set(currentFilteredFindings.map(f => f.batch_number).filter(b => b));
    uniqueBatchesForBRFT = uniqueBatchSet.size;
    
    const monthTarget = targets.find(t => t.target_month === currentMonth);
    targetValue = monthTarget ? monthTarget.target_value : 0;
  }

  document.getElementById('target-docs').textContent = isValidForBRFT ? targetValue : '-';

  const brftPercent = isValidForBRFT && targetValue > 0 ? ((targetValue - uniqueBatchesForBRFT) / targetValue) * 100 : null;
  const brftEl = document.getElementById('brft-percentage');
  const indicatorEl = document.getElementById('brft-indicator');

  if (brftPercent !== null) {
    brftEl.textContent = brftPercent.toFixed(1) + '%';
    if (brftPercent >= 100) {
      brftEl.className = 'text-3xl font-bold text-emerald-400';
      indicatorEl.className = 'w-12 h-12 bg-emerald-500/20 rounded-xl flex items-center justify-center';
    } else {
      brftEl.className = 'text-3xl font-bold text-red-400';
      indicatorEl.className = 'w-12 h-12 bg-red-500/20 rounded-xl flex items-center justify-center';
    }
  } else {
    brftEl.textContent = '-';
    brftEl.className = 'text-3xl font-bold text-gray-400';
    indicatorEl.className = 'w-12 h-12 bg-gray-500/20 rounded-xl flex items-center justify-center';
  }

  updateCharts(currentFilteredFindings);
  updateFindingsTable(currentFilteredFindings);
}

// Update Charts
function updateCharts(filteredFindings) {
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { 
      legend: { display: false },
      datalabels: {
        anchor: 'center',
        align: 'center',
        color: '#ffffff',
        font: { size: 14, weight: 'bold' },
        formatter: (value) => value > 0 ? value : ''
      }
    },
    scales: {
      x: { grid: { color: '#374151' }, ticks: { color: '#9ca3af', font: { size: 10 } } },
      y: { grid: { color: '#374151' }, ticks: { color: '#9ca3af', font: { size: 10 } } }
    }
  };

  const currentYear = new Date().getFullYear();
  const monthlyData = {};
  findings.forEach(f => {
    if (f.date) {
      const month = f.date.substring(0, 7);
      const year = parseInt(f.date.substring(0, 4));
      if (year === currentYear) {
        monthlyData[month] = (monthlyData[month] || 0) + 1;
      }
    }
  });

  const months = Object.keys(monthlyData).sort();
  
  const monthLabels = months.map(m => {
    const [year, month] = m.split('-');
    const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return `${monthNames[parseInt(month) - 1]} ${year}`;
  });

  const brftTrend = months.map(m => {
    const target = targets.find(t => t.target_month === m);
    if (target) {
      const findingsInMonth = findings.filter(f => f.date && f.date.startsWith(m));
      const uniqueBatchSet = new Set(findingsInMonth.map(f => f.batch_number).filter(b => b));
      const uniqueBatchCount = uniqueBatchSet.size;
      
      const pct = target.target_value > 0 ? ((target.target_value - uniqueBatchCount) / target.target_value) * 100 : 0;
      return pct;
    }
    return 0;
  });

  if (charts.trend) charts.trend.destroy();
  charts.trend = new Chart(document.getElementById('chart-trend'), {
    type: 'line',
    data: {
      labels: monthLabels,
      datasets: [{
        data: brftTrend,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        fill: true,
        tension: 0.4
      }]
    },
    options: { 
      ...chartOptions, 
      scales: { 
        ...chartOptions.scales, 
        y: { ...chartOptions.scales.y, min: 0, max: 100 } 
      },
      plugins: {
        ...chartOptions.plugins,
        datalabels: {
          ...chartOptions.plugins.datalabels,
          formatter: (value) => value > 0 ? value.toFixed(1) + '%' : ''
        }
      }
    },
    plugins: [ChartDataLabels]
  });

  if (charts.monthly) charts.monthly.destroy();
  charts.monthly = new Chart(document.getElementById('chart-monthly'), {
    type: 'bar',
    data: {
      labels: monthLabels,
      datasets: [{ data: months.map(m => monthlyData[m]), backgroundColor: '#f59e0b' }]
    },
    options: chartOptions,
    plugins: [ChartDataLabels]
  });

  const areaData = {};
  filteredFindings.forEach(f => { if (f.area) areaData[f.area] = (areaData[f.area] || 0) + 1; });
  const areaSorted = Object.entries(areaData).sort((a, b) => b[1] - a[1]);
  if (charts.area) charts.area.destroy();
  charts.area = new Chart(document.getElementById('chart-area'), {
    type: 'bar',
    data: {
      labels: areaSorted.map(a => a[0]),
      datasets: [{ data: areaSorted.map(a => a[1]), backgroundColor: '#3b82f6' }]
    },
    options: chartOptions,
    plugins: [ChartDataLabels]
  });

  const productData = {};
  filteredFindings.forEach(f => { if (f.product_code) productData[f.product_code] = (productData[f.product_code] || 0) + 1; });
  const productSorted = Object.entries(productData).sort((a, b) => b[1] - a[1]);
  if (charts.product) charts.product.destroy();
  charts.product = new Chart(document.getElementById('chart-product'), {
    type: 'bar',
    data: {
      labels: productSorted.map(p => p[0]),
      datasets: [{ data: productSorted.map(p => p[1]), backgroundColor: '#8b5cf6' }]
    },
    options: chartOptions,
    plugins: [ChartDataLabels]
  });

  const operatorData = {};
  filteredFindings.forEach(f => { 
    if (f.operator_initial) operatorData[f.operator_initial] = (operatorData[f.operator_initial] || 0) + 1; 
  });
  const operatorSorted = Object.entries(operatorData).sort((a, b) => b[1] - a[1]);
  
  if (charts.operator) charts.operator.destroy();
  charts.operator = new Chart(document.getElementById('chart-operator'), {
    type: 'bar',
    data: {
      labels: operatorSorted.map(o => o[0]),
      datasets: [{ 
        data: operatorSorted.map(o => o[1]), 
        backgroundColor: '#ec4899' 
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { 
        legend: { display: false },
        datalabels: {
          anchor: 'center',
          align: 'center',
          color: '#ffffff',
          font: { size: 12, weight: 'bold' },
          formatter: (value) => value > 0 ? value : ''
        }
      },
      scales: {
        x: { 
          grid: { color: '#374151' }, 
          ticks: { 
            color: '#9ca3af', 
            font: { size: 9 },
            maxRotation: 90,
            minRotation: 45,
            autoSkip: false
          },
          afterFit: function(scale) {
            scale.height = scale.height + 40;
          }
        },
        y: { 
          grid: { color: '#374151' }, 
          ticks: { 
            color: '#9ca3af', 
            font: { size: 10 },
            precision: 0
          },
          beginAtZero: true
        }
      },
      layout: {
        padding: {
          bottom: 40
        }
      }
    },
    plugins: [ChartDataLabels]
  });

  const categoryData = {};
  filteredFindings.forEach(f => { if (f.category) categoryData[f.category] = (categoryData[f.category] || 0) + 1; });
  const categorySorted = Object.entries(categoryData).sort((a, b) => b[1] - a[1]);
  if (charts.category) charts.category.destroy();
  charts.category = new Chart(document.getElementById('chart-category'), {
    type: 'bar',
    data: {
      labels: categorySorted.map(c => c[0]),
      datasets: [{ data: categorySorted.map(c => c[1]), backgroundColor: '#14b8a6' }]
    },
    options: chartOptions,
    plugins: [ChartDataLabels]
  });
}

// Update Findings Table
function updateFindingsTable(filteredFindings) {
  const tbody = document.getElementById('findings-table');
  if (filteredFindings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-gray-500">TIDAK ADA DATA</td></tr>';
    return;
  }

  tbody.innerHTML = filteredFindings.sort((a, b) => new Date(a.date) - new Date(b.date)).map((f, index) => {
    let formattedDate = '-';
    if (f.date) {
      const [year, month, day] = f.date.split('-');
      const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      formattedDate = `${day} ${monthNames[parseInt(month) - 1]} ${year}`;
    }

    return `
      <tr class="hover:bg-gray-700/50">
        <td class="py-3 px-3 text-gray-300">${index + 1}</td>
        <td class="py-3 px-3 text-gray-300">${formattedDate}</td>
        <td class="py-3 px-3 text-gray-300">${f.operator_initial || '-'}</td>
        <td class="py-3 px-3 text-gray-300">${f.area || '-'}</td>
        <td class="py-3 px-3"><span class="px-2 py-1 bg-amber-500/20 text-amber-400 rounded text-xs">${f.category || '-'}</span></td>
        <td class="py-3 px-3 text-gray-300">${f.batch_number || '-'}</td>
        <td class="py-3 px-3 text-gray-300 max-w-xs whitespace-normal break-words">${f.description || '-'}</td>
      </tr>
    `;
  }).join('');
}

// Update Management Lists
function updateManagementLists() {
  document.getElementById('operators-list').innerHTML = operators.length === 0
    ? '<p class="text-gray-500 text-center py-4">TIDAK ADA DATA</p>'
    : operators.map(o => createMasterItem(o, 'operator')).join('');

  document.getElementById('products-list').innerHTML = products.length === 0
    ? '<p class="text-gray-500 text-center py-4">TIDAK ADA DATA</p>'
    : products.map(p => createMasterItem(p, 'product')).join('');

  document.getElementById('areas-list').innerHTML = areas.length === 0
    ? '<p class="text-gray-500 text-center py-4">TIDAK ADA DATA</p>'
    : areas.map(a => createMasterItem(a, 'area')).join('');

  document.getElementById('categories-list').innerHTML = categories.length === 0
    ? '<p class="text-gray-500 text-center py-4">TIDAK ADA DATA</p>'
    : categories.map(c => createMasterItem(c, 'category')).join('');

  document.getElementById('targets-list').innerHTML = targets.length === 0
    ? '<p class="text-gray-500 text-center py-4">TIDAK ADA DATA</p>'
    : targets.sort((a, b) => b.target_month.localeCompare(a.target_month)).map(t => {
        const monthFindings = findings.filter(f => f.date && f.date.startsWith(t.target_month)).length;
        const brft = calculateBRFT(t.target_month, t.target_value, monthFindings);
        return `
          <div class="flex items-center justify-between bg-gray-700 rounded-lg px-4 py-3" data-id="${t.id}">
            <div class="flex-1">
              <span class="font-medium">${t.target_month}</span>
              <span class="text-gray-400 ml-2">TARGET: ${t.target_value}</span>
              <span class="text-gray-400 ml-2">TEMUAN: ${monthFindings}</span>
              <span class="ml-2 ${brft >= 95 ? 'text-emerald-400' : brft >= 90 ? 'text-amber-400' : 'text-red-400'}">${brft !== null ? brft.toFixed(1) + '%' : '-'}</span>
            </div>
            <div class="flex gap-2">
              <button class="edit-target text-blue-400 hover:text-blue-300 p-1" data-id="${t.id}">✏️</button>
              <button class="delete-target text-red-400 hover:text-red-300 p-1" data-id="${t.id}">🗑️</button>
            </div>
          </div>
        `;
      }).join('');

  document.getElementById('findings-mgmt-list').innerHTML = findings.length === 0
    ? '<tr><td colspan="5" class="py-8 text-center text-gray-500">TIDAK ADA DATA</td></tr>'
    : findings.sort((a, b) => new Date(b.date) - new Date(a.date)).map(f => `
        <tr class="hover:bg-gray-700/50" data-id="${f.id}">
          <td class="py-2 px-2 text-gray-300">${f.date || '-'}</td>
          <td class="py-2 px-2 text-gray-300">${f.operator_name || f.operator_initial || '-'}</td>
          <td class="py-2 px-2 text-gray-300">${f.area_name || '-'}</td>
          <td class="py-2 px-2 text-gray-300">${f.batch_number || '-'}</td>
          <td class="py-2 px-2">
            <button class="delete-finding text-red-400 hover:text-red-300" data-id="${f.id}">🗑️</button>
          </td>
        </tr>
      `).join('');

  addManagementEventListeners();
}

function createMasterItem(item, type) {
  return `
    <div class="flex items-center justify-between bg-gray-700 rounded-lg px-4 py-3" data-id="${item.id}">
      <span class="font-medium">${item.name}</span>
      <div class="flex gap-2">
        <button class="edit-${type} text-blue-400 hover:text-blue-300 p-1" data-id="${item.id}">✏️</button>
        <button class="delete-${type} text-red-400 hover:text-red-300 p-1" data-id="${item.id}">🗑️</button>
      </div>
    </div>
  `;
}

function addManagementEventListeners() {
  ['operator', 'product', 'area', 'category'].forEach(type => {
    document.querySelectorAll(`.edit-${type}`).forEach(btn => {
      btn.addEventListener('click', () => openEditModal(type, btn.dataset.id));
    });
    document.querySelectorAll(`.delete-${type}`).forEach(btn => {
      btn.addEventListener('click', () => openDeleteModal(type, btn.dataset.id));
    });
  });

  document.querySelectorAll('.edit-target').forEach(btn => {
    btn.addEventListener('click', () => openEditTargetModal(btn.dataset.id));
  });
  document.querySelectorAll('.delete-target').forEach(btn => {
    btn.addEventListener('click', () => openDeleteModal('target', btn.dataset.id));
  });
  document.querySelectorAll('.delete-finding').forEach(btn => {
    btn.addEventListener('click', () => openDeleteModal('finding', btn.dataset.id));
  });
}

// Update Audit Table
function updateAuditTable(filteredLogs = null) {
  const logs = filteredLogs || auditLogs;
  const tbody = document.getElementById('audit-table');

  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="py-8 text-center text-gray-500">TIDAK ADA LOG</td></tr>';
    return;
  }

  tbody.innerHTML = logs.map(log => {
    const actionColor = log.action === 'CREATE' ? 'text-emerald-400' :
                       log.action === 'UPDATE' ? 'text-blue-400' :
                       log.action === 'DELETE' ? 'text-red-400' : 'text-amber-400';
    return `
      <tr class="hover:bg-gray-700/50">
        <td class="py-3 px-3 text-gray-300 text-xs">${new Date(log.created_at).toLocaleString('ID-id')}</td>
        <td class="py-3 px-3"><span class="px-2 py-1 rounded text-xs font-medium ${actionColor}">${log.action}</span></td>
        <td class="py-3 px-3 text-gray-300 text-xs">${log.details}</td>
      </tr>
    `;
  }).join('');
}

// Modal Functions
function openDeleteModal(type, id) {
  document.getElementById('delete-modal').classList.remove('hidden');
  deleteCallback = async () => {
    try {
      let tableName = '';
      let item = null;

      if (type === 'operator') {
        tableName = 'operators';
        item = operators.find(o => o.id === parseInt(id));
      } else if (type === 'product') {
        tableName = 'products';
        item = products.find(p => p.id === parseInt(id));
      } else if (type === 'area') {
        tableName = 'areas';
        item = areas.find(a => a.id === parseInt(id));
      } else if (type === 'category') {
        tableName = 'categories';
        item = categories.find(c => c.id === parseInt(id));
      } else if (type === 'target') {
        tableName = 'targets';
        item = targets.find(t => t.id === parseInt(id));
      } else if (type === 'finding') {
        tableName = 'findings';
        item = findings.find(f => f.id === parseInt(id));
      }

      if (!item || !tableName) {
        showToast('DATA TIDAK DITEMUKAN', 'error');
        document.getElementById('delete-modal').classList.add('hidden');
        return;
      }

      const { error } = await supabaseClient.from(tableName).delete().eq('id', item.id);
      if (error) throw error;

      await addAuditLog('DELETE', `DELETED ${type.toUpperCase()}: ${item.name || item.target_month || item.batch_number || id}`);
      
      await loadAllData();
      
      showToast('DATA BERHASIL DIHAPUS', 'success');
    } catch (error) {
      console.error('Error deleting:', error);
      showToast('GAGAL MENGHAPUS DATA: ' + error.message, 'error');
    }
    document.getElementById('delete-modal').classList.add('hidden');
  };
}

function openEditModal(type, id) {
  let item = null;
  if (type === 'operator') item = operators.find(o => o.id === parseInt(id));
  else if (type === 'product') item = products.find(p => p.id === parseInt(id));
  else if (type === 'area') item = areas.find(a => a.id === parseInt(id));
  else if (type === 'category') item = categories.find(c => c.id === parseInt(id));

  if (!item) return;

  document.getElementById('edit-value').value = item.name || '';
  document.getElementById('edit-modal').classList.remove('hidden');

  editCallback = async () => {
    const newValue = document.getElementById('edit-value').value.trim().toUpperCase();
    if (!newValue) {
      showToast('NILAI TIDAK BOLEH KOSONG', 'error');
      return;
    }

    try {
      let tableName = '';
      if (type === 'operator') tableName = 'operators';
      else if (type === 'product') tableName = 'products';
      else if (type === 'area') tableName = 'areas';
      else if (type === 'category') tableName = 'categories';

      const oldValue = item.name;
      const { error } = await supabaseClient.from(tableName).update({ name: newValue }).eq('id', item.id);
      if (error) throw error;

      await addAuditLog('UPDATE', `UPDATED ${type.toUpperCase()}: ${oldValue} → ${newValue}`);
      
      await loadAllData();
      
      showToast('DATA BERHASIL DIUPDATE', 'success');
    } catch (error) {
      console.error('Error updating:', error);
      showToast('GAGAL UPDATE DATA: ' + error.message, 'error');
    }
    document.getElementById('edit-modal').classList.add('hidden');
  };
}

function openEditTargetModal(id) {
  const target = targets.find(t => t.id === parseInt(id));
  if (!target) return;

  document.getElementById('edit-value').value = target.target_value || '';
  document.getElementById('edit-modal').classList.remove('hidden');

  editCallback = async () => {
    const newValue = parseInt(document.getElementById('edit-value').value);
    if (isNaN(newValue) || newValue <= 0) {
      showToast('NILAI TARGET TIDAK VALID', 'error');
      return;
    }

    try {
      const oldValue = target.target_value;
      const { error } = await supabaseClient.from('targets').update({ target_value: newValue }).eq('id', target.id);
      if (error) throw error;

      await addAuditLog('UPDATE', `UPDATED TARGET ${target.target_month}: ${oldValue} → ${newValue}`);
      
      await loadAllData();
      
      showToast('TARGET BERHASIL DIUPDATE', 'success');
    } catch (error) {
      console.error('Error updating target:', error);
      showToast('GAGAL UPDATE TARGET: ' + error.message, 'error');
    }
    document.getElementById('edit-modal').classList.add('hidden');
  };
}

// Modal Event Listeners
document.getElementById('confirm-delete').addEventListener('click', () => {
  if (deleteCallback) deleteCallback();
});
document.getElementById('cancel-delete').addEventListener('click', () => {
  document.getElementById('delete-modal').classList.add('hidden');
});
document.getElementById('confirm-edit').addEventListener('click', () => {
  if (editCallback) editCallback();
});
document.getElementById('cancel-edit').addEventListener('click', () => {
  document.getElementById('edit-modal').classList.add('hidden');
});

// Finding Form Submit
document.getElementById('finding-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const btn = document.getElementById('submit-finding');
  btn.disabled = true;
  btn.innerHTML = '⏳ MENYIMPAN...';

  const areaId = parseInt(document.getElementById('input-area').value);
  const categoryId = parseInt(document.getElementById('input-category').value);
  const productId = parseInt(document.getElementById('input-product').value);
  const operatorId = parseInt(document.getElementById('input-operator').value);
  const batchNumber = document.getElementById('input-batch').value.toUpperCase();
  const description = document.getElementById('input-description').value.toUpperCase();
  const date = document.getElementById('input-date').value;

  try {
    const { data, error } = await supabaseClient.from('findings').insert({
      date: date,
      area_id: areaId,
      category_id: categoryId,
      product_id: productId,
      operator_id: operatorId,
      batch_number: batchNumber,
      description: description
    }).select();

    if (error) throw error;

    const area = areas.find(a => a.id === areaId)?.name || '';
    const product = products.find(p => p.id === productId)?.name || '';
    const category = categories.find(c => c.id === categoryId)?.name || '';
    const operator = operators.find(o => o.id === operatorId)?.name || '';

    await addAuditLog('CREATE', `NEW FINDING: BATCH ${batchNumber}, AREA ${area}`, area, product, category, operator);
    showToast('TEMUAN BERHASIL DISIMPAN', 'success');
    document.getElementById('finding-form').reset();
    
    await loadAllData();
  } catch (error) {
    console.error('Error saving finding:', error);
    showToast('GAGAL MENYIMPAN TEMUAN: ' + error.message, 'error');
  }

  btn.disabled = false;
  btn.innerHTML = '<span>💾</span> SIMPAN TEMUAN';
});

// Admin Login
document.getElementById('admin-login-btn').addEventListener('click', () => {
  const password = document.getElementById('admin-password').value;
  if (password === 'admin123') {
    isAdminLoggedIn = true;
    document.getElementById('admin-login').classList.add('hidden');
    document.getElementById('admin-panel').classList.remove('hidden');
    addAuditLog('LOGIN', 'ADMIN LOGIN SUCCESSFUL');
    showToast('LOGIN BERHASIL', 'success');
  } else {
    showToast('PASSWORD SALAH', 'error');
  }
});

document.getElementById('admin-logout').addEventListener('click', () => {
  isAdminLoggedIn = false;
  document.getElementById('admin-panel').classList.add('hidden');
  document.getElementById('admin-login').classList.remove('hidden');
  document.getElementById('admin-password').value = '';
  addAuditLog('LOGOUT', 'ADMIN LOGOUT');
  showToast('LOGOUT BERHASIL', 'info');
});

// Add Master Data
async function addMasterData(type, inputId, tableName) {
  const input = document.getElementById(inputId);
  const value = input.value.trim().toUpperCase();
  if (!value) {
    showToast('NILAI TIDAK BOLEH KOSONG', 'error');
    return;
  }

  input.value = '';

  try {
    const { data, error } = await supabaseClient.from(tableName).insert({ name: value }).select();
    if (error) throw error;

    await addAuditLog('CREATE', `NEW ${type.toUpperCase()}: ${value}`);
    showToast(`${type.toUpperCase()} BERHASIL DITAMBAHKAN`, 'success');
    
    await loadAllData();
  } catch (error) {
    console.error('Error adding master data:', error);
    showToast('GAGAL MENAMBAHKAN DATA: ' + error.message, 'error');
  }
}

document.getElementById('add-operator').addEventListener('click', () => addMasterData('operator', 'new-operator', 'operators'));
document.getElementById('add-product').addEventListener('click', () => addMasterData('product', 'new-product', 'products'));
document.getElementById('add-area').addEventListener('click', () => addMasterData('area', 'new-area', 'areas'));
document.getElementById('add-category').addEventListener('click', () => addMasterData('category', 'new-category', 'categories'));

// Add Target
document.getElementById('add-target').addEventListener('click', async () => {
  const month = document.getElementById('new-target-month').value;
  const value = parseInt(document.getElementById('new-target-value').value);

  if (!month || isNaN(value) || value <= 0) {
    showToast('DATA TIDAK VALID', 'error');
    return;
  }

  const existingTarget = targets.find(t => t.target_month === month);
  if (existingTarget) {
    showToast('TARGET BULAN INI SUDAH ADA', 'error');
    return;
  }

  document.getElementById('new-target-month').value = '';
  document.getElementById('new-target-value').value = '';

  try {
    const { data, error } = await supabaseClient.from('targets').insert({
      target_month: month,
      target_value: value
    }).select();

    if (error) throw error;

    await addAuditLog('CREATE', `NEW TARGET: ${month} = ${value}`);
    showToast('TARGET BERHASIL DITAMBAHKAN', 'success');
    
    await loadAllData();
  } catch (error) {
    console.error('Error adding target:', error);
    showToast('GAGAL MENAMBAHKAN TARGET: ' + error.message, 'error');
  }
});

// Filters
document.getElementById('apply-filter').addEventListener('click', updateDashboard);
document.getElementById('reset-filter').addEventListener('click', () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const firstDay = `${year}-${month}-01`;
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
  const lastDayFormatted = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

  document.getElementById('filter-date-from').value = firstDay;
  document.getElementById('filter-date-to').value = lastDayFormatted;
  
  selectedFilters.areas.clear();
  selectedFilters.products.clear();
  selectedFilters.categories.clear();
  selectedFilters.operators.clear();
  
  ['area', 'product', 'category', 'operator'].forEach(type => {
    document.getElementById(`filter-${type}-all`).checked = true;
    document.querySelectorAll(`.filter-${type}-checkbox`).forEach(cb => cb.checked = false);
    updateMultiSelectLabel(type);
  });
  
  updateDashboard();
});

// Audit Filters
document.getElementById('audit-filter-btn').addEventListener('click', () => {
  const dateFrom = document.getElementById('audit-date-from').value;
  const dateTo = document.getElementById('audit-date-to').value;
  const area = document.getElementById('audit-filter-area').value;
  const product = document.getElementById('audit-filter-product').value;
  const category = document.getElementById('audit-filter-category').value;
  const initial = document.getElementById('audit-filter-initial').value;

  let filtered = [...auditLogs];
  if (dateFrom) filtered = filtered.filter(l => l.created_at >= dateFrom);
  if (dateTo) filtered = filtered.filter(l => l.created_at <= dateTo + 'T23:59:59');
  if (area) filtered = filtered.filter(l => l.area === area);
  if (product) filtered = filtered.filter(l => l.product === product);
  if (category) filtered = filtered.filter(l => l.category === category);
  if (initial) filtered = filtered.filter(l => l.operator_initial === initial);

  updateAuditTable(filtered);
});

document.getElementById('audit-reset-btn').addEventListener('click', () => {
  document.getElementById('audit-date-from').value = '';
  document.getElementById('audit-date-to').value = '';
  document.getElementById('audit-filter-area').value = '';
  document.getElementById('audit-filter-product').value = '';
  document.getElementById('audit-filter-category').value = '';
  document.getElementById('audit-filter-initial').value = '';
  updateAuditTable();
});

// Export PDF for Findings
document.getElementById('export-pdf-findings').addEventListener('click', () => {
  if (currentFilteredFindings.length === 0) {
    showToast('TIDAK ADA DATA UNTUK DIEXPORT', 'error');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text('LAPORAN DETAIL TEMUAN BRFT', 105, 15, { align: 'center' });
  
  const dateFrom = document.getElementById('filter-date-from').value;
  const dateTo = document.getElementById('filter-date-to').value;
  const filterInfo = dateFrom && dateTo ? 
    `Periode: ${dateFrom} s/d ${dateTo}` : 
    'Periode: Semua Data';
  
  doc.setFontSize(10);
  doc.text(filterInfo, 105, 22, { align: 'center' });
  doc.text(`Generated: ${new Date().toLocaleString('ID-id')}`, 105, 28, { align: 'center' });
  doc.text(`Total Temuan: ${currentFilteredFindings.length}`, 105, 34, { align: 'center' });

  let y = 45;
  doc.setFontSize(9);
  doc.setFillColor(40, 40, 40);
  doc.setTextColor(255, 255, 255);
  doc.rect(15, y-5, 180, 7, 'F');
  
  doc.text('NO', 17, y);
  doc.text('TANGGAL', 30, y);
  doc.text('INISIAL', 60, y);
  doc.text('AREA', 75, y);
  doc.text('KATEGORI', 95, y);
  doc.text('NO. BATCH', 115, y);
  doc.text('TEMUAN PPI', 140, y);

  y += 5;
  doc.setTextColor(0, 0, 0);
  
  doc.setFontSize(8);
  currentFilteredFindings.sort((a, b) => new Date(a.date) - new Date(b.date)).forEach((f, index) => {
    if (y > 280) {
      doc.addPage();
      y = 20;
      doc.setFontSize(9);
      doc.setFillColor(40, 40, 40);
      doc.setTextColor(255, 255, 255);
      doc.rect(15, y-5, 180, 7, 'F');
      doc.text('NO', 17, y);
      doc.text('TANGGAL', 30, y);
      doc.text('INISIAL', 60, y);
      doc.text('AREA', 75, y);
      doc.text('KATEGORI', 95, y);
      doc.text('NO. BATCH', 115, y);
      doc.text('TEMUAN PPI', 140, y);
      y += 5;
      doc.setTextColor(0, 0, 0);
    }

    let formattedDate = '-';
    if (f.date) {
      const [year, month, day] = f.date.split('-');
      const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      formattedDate = `${day} ${monthNames[parseInt(month) - 1]} ${year}`;
    }

    doc.text(`${index + 1}`, 17, y);
    doc.text(formattedDate, 30, y);
    doc.text(f.operator_initial || '-', 60, y);
    doc.text(f.area || '-', 75, y);
    doc.text(f.category || '-', 95, y);
    doc.text(f.batch_number || '-', 115, y);
    
    const desc = f.description || '-';
    const maxWidth = 55;
    const lines = doc.splitTextToSize(desc, maxWidth);
    
    lines.forEach((line, idx) => {
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
      if (idx === 0) {
        doc.text(line, 140, y);
      } else {
        doc.text(line, 140, y);
      }
      if (idx < lines.length - 1) y += 4;
    });
    
    y += 6;
  });

  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text('BRFT Monitoring System - Created by MSTD', 105, 290, { align: 'center' });

  doc.save(`BRFT_TEMUAN_${new Date().toISOString().split('T')[0]}.pdf`);
  showToast('PDF TEMUAN BERHASIL DIEXPORT', 'success');
});

// Export Excel for Findings
document.getElementById('export-excel-findings').addEventListener('click', () => {
  if (currentFilteredFindings.length === 0) {
    showToast('TIDAK ADA DATA UNTUK DIEXPORT', 'error');
    return;
  }

  const excelData = currentFilteredFindings.sort((a, b) => new Date(a.date) - new Date(b.date)).map((f, index) => {
    let formattedDate = '-';
    if (f.date) {
      const [year, month, day] = f.date.split('-');
      const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      formattedDate = `${day} ${monthNames[parseInt(month) - 1]} ${year}`;
    }

    return {
      NO: index + 1,
      TANGGAL: formattedDate,
      INISIAL: f.operator_initial || '-',
      AREA: f.area || '-',
      KATEGORI: f.category || '-',
      'NO. BATCH': f.batch_number || '-',
      'TEMUAN PPI': f.description || '-'
    };
  });

  const ws = XLSX.utils.json_to_sheet(excelData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Temuan BRFT");
  
  const dateFrom = document.getElementById('filter-date-from').value;
  const dateTo = document.getElementById('filter-date-to').value;
  const filterInfo = dateFrom && dateTo ? 
    `Periode: ${dateFrom} s/d ${dateTo}` : 
    'Periode: Semua Data';
  
  const fileName = `BRFT_TEMUAN_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, fileName);
  
  showToast('EXCEL TEMUAN BERHASIL DIEXPORT', 'success');
});

// Export PDF for Audit
document.getElementById('export-pdf-audit').addEventListener('click', () => {
  const dateFrom = document.getElementById('audit-date-from').value;
  const dateTo = document.getElementById('audit-date-to').value;
  const area = document.getElementById('audit-filter-area').value;
  const product = document.getElementById('audit-filter-product').value;
  const category = document.getElementById('audit-filter-category').value;
  const initial = document.getElementById('audit-filter-initial').value;

  let filtered = [...auditLogs];
  if (dateFrom) filtered = filtered.filter(l => l.created_at >= dateFrom);
  if (dateTo) filtered = filtered.filter(l => l.created_at <= dateTo + 'T23:59:59');
  if (area) filtered = filtered.filter(l => l.area === area);
  if (product) filtered = filtered.filter(l => l.product === product);
  if (category) filtered = filtered.filter(l => l.category === category);
  if (initial) filtered = filtered.filter(l => l.operator_initial === initial);

  if (filtered.length === 0) {
    showToast('TIDAK ADA DATA UNTUK DIEXPORT', 'error');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text('BRFT AUDIT TRAIL REPORT', 105, 20, { align: 'center' });
  doc.setFontSize(10);
  doc.text(`GENERATED: ${new Date().toLocaleString('ID-id')}`, 105, 28, { align: 'center' });

  let y = 40;
  doc.setFontSize(8);
  doc.text('TIMESTAMP', 15, y);
  doc.text('ACTION', 70, y);
  doc.text('DETAILS', 100, y);

  y += 5;
  doc.line(15, y, 195, y);
  y += 5;

  filtered.forEach(log => {
    if (y > 280) {
      doc.addPage();
      y = 20;
    }

    const timestamp = new Date(log.created_at).toLocaleString('ID-id', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    doc.text(timestamp, 15, y);
    doc.text(log.action || '', 70, y);
    
    const details = log.details || '';
    const maxWidth = 90;
    const lines = doc.splitTextToSize(details, maxWidth);
    
    lines.forEach((line, idx) => {
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
      doc.text(line, 100, y);
      if (idx < lines.length - 1) y += 4;
    });
    
    y += 6;
  });

  doc.save(`BRFT_AUDIT_${new Date().toISOString().split('T')[0]}.pdf`);
  showToast('PDF AUDIT BERHASIL DIEXPORT', 'success');
});

// Theme Toggle
document.getElementById('theme-toggle').addEventListener('click', () => {
  document.body.classList.toggle('bg-gray-100');
  document.body.classList.toggle('bg-gray-900');
  document.body.classList.toggle('text-gray-900');
  document.body.classList.toggle('text-gray-100');
});

// Update Date and Time
function updateDateTime() {
  document.getElementById('current-date').textContent = new Date().toLocaleDateString('ID-id', { 
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
  }).toUpperCase();
  
  document.getElementById('current-time').textContent = new Date().toLocaleTimeString('ID-id', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

updateDateTime();
setInterval(updateDateTime, 1000);

// Initialize Data SDK
async function init() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const firstDay = `${year}-${month}-01`;
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
  const lastDayFormatted = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

  document.getElementById('filter-date-from').value = firstDay;
  document.getElementById('filter-date-to').value = lastDayFormatted;

  setupMultiSelectDropdowns();

  await loadAllData();
  setupRealtimeSubscriptions();
  updateDashboard();
}

init();
// =============== SAMPE SINI ===============