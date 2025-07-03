// Initialize Firebase
if (!firebase.apps.length) {
  firebase.initializeApp({
    apiKey: "AIzaSyD2WZnOuDXBLXR7uAq_LTK46q7tr13Mqvw",
    authDomain: "gadendigitech.firebaseapp.com",
    projectId: "gadendigitech",
    storageBucket: "gadendigitech.firebasestorage.app",
    messagingSenderId: "134032321432",
    appId: "1:134032321432:web:dedbb18980661259ed",
    measurementId: "G-VLG9G3FCP0"
  });
}
const auth = firebase.auth();
const db = firebase.firestore();

// Global variables
let products = [];
let currentSaleItems = [];
let barcodeInputBuffer = '';
let barcodeTimeout;
const BARCODE_DELAY = 50; // Time between barcode characters (ms)

// Initialize the sales system
auth.onAuthStateChanged(user => {
  if (!user) {
    window.location = 'index.html';
  } else {
    loadProducts();
    setupBarcodeScanner();
    setupSalesForm();
    loadSalesRecords();
    loadCreditSales();
    calculateProfit();
    document.getElementById('saleDate').valueAsDate = new Date(); // Set default date
    document.getElementById('saleBarcode').focus();

    // Setup grouped receipt print button handler if form exists
    const groupReceiptForm = document.getElementById('groupReceiptForm');
    if (groupReceiptForm) {
      groupReceiptForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const clientName = document.getElementById('receipt-client').value.trim();
        const date = document.getElementById('receipt-date').value;
        if (!clientName || !date) {
          alert("Please enter both client name and date.");
          return;
        }
        try {
          const salesSnapshot = await db.collection("sales")
            .where("clientName", "==", clientName)
            .where("date", "==", date)
            .get();
          if (salesSnapshot.empty) {
            alert("No sales found for this client on this date.");
            return;
          }
          const items = [];
          let clientPhone = '';
          salesSnapshot.forEach(doc => {
            const sale = doc.data();
            items.push({
              sold: sale.itemSold || '',
              description: sale.description || '',
              partNumber: sale.partNumber || '',
              quantity: sale.quantitySold || 0,
              price: sale.price || (sale.amount / sale.quantitySold) || 0
            });
            if (!clientPhone && sale.clientPhone) clientPhone = sale.clientPhone;
          });
          let total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
          let cashInput = prompt("Enter cash received for this group sale:", total.toFixed(2));
          let cash = parseFloat(cashInput);
          if (isNaN(cash) || cash < total) {
            alert("Invalid cash amount entered. Using total sale amount as cash.");
            cash = total;
          }
          const saleForReceipt = {
            items: items,
            cash: cash,
            date: date,
            clientName: clientName,
            clientPhone: clientPhone
          };
          generateGroupReceipt(saleForReceipt);
        } catch (error) {
          console.error("Error generating group receipt:", error);
          alert("Failed to generate group receipt. Check console for details.");
        }
      });
    }
  }
});

// Load all products from Firestore
async function loadProducts() {
  try {
    const snapshot = await db.collection('stockmgt').get();
    products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log(`${products.length} products loaded`);
  } catch (error) {
    console.error("Error loading products:", error);
    alert("Error loading products. Check console for details.");
  }
}

// Setup USB barcode scanner handler
function setupBarcodeScanner() {
  const barcodeInput = document.getElementById('saleBarcode');
  
  barcodeInput.addEventListener('keydown', function(e) {
    clearTimeout(barcodeTimeout);
    
    if (e.key === 'Enter') {
      e.preventDefault();
      processScannedBarcode(barcodeInputBuffer.trim());
      barcodeInputBuffer = '';
      return;
    }
    
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      barcodeInputBuffer += e.key;
      barcodeTimeout = setTimeout(() => barcodeInputBuffer = '', BARCODE_DELAY);
    }
  });
}

// Process scanned barcode
async function processScannedBarcode(barcode) {
  if (!barcode) return;
  
  const product = products.find(p => p.barcode === barcode);
  const barcodeInput = document.getElementById('saleBarcode');
  
  if (product) {
    const existingItemIndex = currentSaleItems.findIndex(item => item.barcode === barcode);
    
    if (existingItemIndex >= 0) {
      if (currentSaleItems[existingItemIndex].quantity < currentSaleItems[existingItemIndex].stockQty) {
        currentSaleItems[existingItemIndex].quantity++;
        currentSaleItems[existingItemIndex].total = 
          currentSaleItems[existingItemIndex].quantity * currentSaleItems[existingItemIndex].sellingPrice;
      } else {
        alert(`Only ${currentSaleItems[existingItemIndex].stockQty} available in stock!`);
      }
    } else {
      currentSaleItems.push({
        ...product,
        quantity: 1,
        total: product.sellingPrice
      });
    }
    
    barcodeInput.value = '';
    updateSaleSummary();
    playSound('success');
    
    const quantityInputs = document.querySelectorAll('.sale-item-quantity');
    if (quantityInputs.length > 0) {
      quantityInputs[quantityInputs.length - 1].focus();
      quantityInputs[quantityInputs.length - 1].select();
    }
  } else {
    barcodeInput.value = '';
    playSound('error');
    alert(`Product with barcode ${barcode} not found!`);
  }
}

// Update sale summary display
function updateSaleSummary() {
  const summaryContainer = document.getElementById('saleItemsContainer');
  summaryContainer.innerHTML = '';
  
  currentSaleItems.forEach((item, index) => {
    const itemElement = document.createElement('div');
    itemElement.className = 'sale-item';
    itemElement.innerHTML = `
      <span>${item.itemName} (${item.barcode})</span>
      <input type="number" class="sale-item-quantity" value="${item.quantity}" 
             min="1" max="${item.stockQty}" data-index="${index}">
      <span>@ ${item.sellingPrice.toFixed(2)}</span>
      <span>= ${item.total.toFixed(2)}</span>
      <button class="remove-item" data-index="${index}">×</button>
    `;
    summaryContainer.appendChild(itemElement);
  });
  
  document.querySelectorAll('.sale-item-quantity').forEach(input => {
    input.addEventListener('change', (e) => {
      const index = parseInt(e.target.dataset.index);
      const newQuantity = parseInt(e.target.value);
      
      if (newQuantity > currentSaleItems[index].stockQty) {
        alert(`Only ${currentSaleItems[index].stockQty} available in stock!`);
        e.target.value = currentSaleItems[index].stockQty;
        return;
      }
      
      if (newQuantity < 1) {
        e.target.value = 1;
        return;
      }
      
      currentSaleItems[index].quantity = newQuantity;
      currentSaleItems[index].total = newQuantity * currentSaleItems[index].sellingPrice;
      updateSaleSummary();
    });
  });
  
  document.querySelectorAll('.remove-item').forEach(button => {
    button.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.index);
      currentSaleItems.splice(index, 1);
      updateSaleSummary();
    });
  });
  
  const subtotal = currentSaleItems.reduce((sum, item) => sum + item.total, 0);
  document.getElementById('saleTotal').value = subtotal.toFixed(2);
}

// Setup sales form submission
function setupSalesForm() {
  document.getElementById('salesForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (currentSaleItems.length === 0) {
      alert('Please scan at least one item!');
      return;
    }
    
    const date = document.getElementById('saleDate').value;
    const clientName = document.getElementById('clientName').value.trim();
    const clientPhone = document.getElementById('clientPhone').value.trim();
    const saleType = document.getElementById('saleType').value;
    
    if (!date || !clientName) {
      alert('Please fill all required fields!');
      return;
    }
    
    try {
      const batch = db.batch();
      const salesRef = db.collection('sales');
      const stockRef = db.collection('stockmgt');
      
      currentSaleItems.forEach(item => {
        const newSaleRef = salesRef.doc();
        batch.set(newSaleRef, {
          date,
          clientName,
          clientPhone,
          barcode: item.barcode,
          itemName: item.itemName,
          quantity: item.quantity,
          costPrice: item.costPrice,
          sellingPrice: item.sellingPrice,
          totalCost: item.costPrice * item.quantity,
          totalSale: item.total,
          saleType,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        const itemRef = stockRef.doc(item.id);
        batch.update(itemRef, {
          stockQty: firebase.firestore.FieldValue.increment(-item.quantity)
        });
      });
      
      await batch.commit();
      
      alert('Sale completed successfully!');
      playSound('success');

      currentSaleItems = [];
      updateSaleSummary();
      document.getElementById('salesForm').reset();
      document.getElementById('saleDate').valueAsDate = new Date();
      document.getElementById('saleBarcode').focus();

      loadProducts();
      loadSalesRecords();
      calculateProfit();
    } catch (error) {
      console.error('Error processing sale:', error);
      alert('Error processing sale. Check console for details.');
      playSound('error');
    }
  });
}

// Play sound feedback
function playSound(type) {
  const audio = new Audio();
  audio.src = type === 'success' ? 
    'https://assets.mixkit.co/sfx/preview/mixkit-cash-register-purchase-2759.mp3' :
    'https://assets.mixkit.co/sfx/preview/mixkit-warning-alarm-688.mp3';
  audio.play();
}

// Load sales records
async function loadSalesRecords() {
  const tbody = document.getElementById('salesRecordsTableBody');
  const fromDate = document.getElementById('filterSalesFromDate')?.value;
  const toDate = document.getElementById('filterSalesToDate')?.value;
  let query = db.collection('sales').orderBy('timestamp', 'desc');
  
  if (fromDate && toDate) {
    const startDate = new Date(fromDate);
    const endDate = new Date(toDate);
    endDate.setDate(endDate.getDate() + 1);
    query = query.where('timestamp', '>=', startDate).where('timestamp', '<=', endDate);
  } else if (fromDate) {
    const startDate = new Date(fromDate);
    query = query.where('timestamp', '>=', startDate);
  } else if (toDate) {
    const endDate = new Date(toDate);
    endDate.setDate(endDate.getDate() + 1);
    query = query.where('timestamp', '<=', endDate);
  }
  
  const snapshot = await query.get();
  tbody.innerHTML = '';
  
  snapshot.forEach(doc => {
    const sale = doc.data();
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${sale.date}</td>
      <td>${sale.clientName}</td>
      <td>${sale.clientPhone}</td>
      <td>${sale.itemName}</td>
      <td>${sale.barcode}</td>
      <td>${sale.quantity}</td>
      <td>${sale.sellingPrice.toFixed(2)}</td>
      <td>${sale.totalSale.toFixed(2)}</td>
      <td>${sale.saleType}</td>
    `;
    tbody.appendChild(tr);
  });
}
window.loadSalesRecords = loadSalesRecords;

// Load credit sales
async function loadCreditSales() {
  const fromDate = document.getElementById('filterCreditsFromDate')?.value;
  const toDate = document.getElementById('filterCreditsToDate')?.value;
  let query = db.collection('creditSales').orderBy('timestamp', 'desc');
  
  if (fromDate && toDate) {
    const startDate = new Date(fromDate);
    const endDate = new Date(toDate);
    endDate.setDate(endDate.getDate() + 1);
    query = query.where('timestamp', '>=', startDate).where('timestamp', '<=', endDate);
  } else if (fromDate) {
    const startDate = new Date(fromDate);
    query = query.where('timestamp', '>=', startDate);
  } else if (toDate) {
    const endDate = new Date(toDate);
    endDate.setDate(endDate.getDate() + 1);
    query = query.where('timestamp', '<=', endDate);
  }
  
  const snapshot = await query.get();
  const tbody = document.getElementById('creditSalesTableBody');
  tbody.innerHTML = '';
  
  snapshot.forEach(doc => {
    const sale = doc.data();
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${sale.date}</td>
      <td>${sale.clientName}</td>
      <td>${sale.clientPhone}</td>
      <td>${sale.itemName}</td>
      <td>${sale.quantity}</td>
      <td>${sale.creditAmount.toFixed(2)}</td>
      <td>${sale.amountPaid.toFixed(2)}</td>
      <td>${sale.balance.toFixed(2)}</td>
      <td>${sale.dueDate || 'N/A'}</td>
      <td>${sale.status}</td>
      <td>
        <button onclick="payCredit('${doc.id}')">Pay</button>
        <button onclick="deleteCredit('${doc.id}')">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}
window.loadCreditSales = loadCreditSales;

// Pay credit
async function payCredit(id) {
  const paymentStr = prompt('Enter payment amount:');
  const payment = parseFloat(paymentStr);
  
  if (isNaN(payment)) {
    alert('Please enter a valid number');
    return;
  }
  
  if (payment <= 0) {
    alert('Payment amount must be positive');
    return;
  }
  
  const docRef = db.collection('creditSales').doc(id);
  const docSnap = await docRef.get();
  
  if (!docSnap.exists) {
    alert('Credit sale not found');
    return;
  }
  
  const data = docSnap.data();
  const newAmountPaid = (data.amountPaid || 0) + payment;
  const newBalance = (data.balance || 0) - payment;
  
  if (newBalance < 0) {
    alert('Payment exceeds balance');
    return;
  }
  const newStatus = newBalance <= 0 ? 'Paid' : 'Partial';
  
  await docRef.update({
    amountPaid: newAmountPaid,
    balance: newBalance,
    status: newStatus,
    lastPaymentDate: new Date().toISOString().split('T')[0]
  });
  
  alert('Payment recorded');
  loadCreditSales();
  calculateProfit();
}
window.payCredit = payCredit;

// Delete credit sale
async function deleteCredit(id) {
  if (confirm('Are you sure you want to delete this credit sale?')) {
    await db.collection('creditSales').doc(id).delete();
    alert('Credit sale deleted');
    loadCreditSales();
  }
}
window.deleteCredit = deleteCredit;

// Calculate profit & loss
async function calculateProfit() {
  const salesSnap = await db.collection('sales').get();
  const creditSnap = await db.collection('creditSales').get();
  
  let totalSales = 0;
  let totalCost = 0;
  let totalProfit = 0;
  
  salesSnap.forEach(doc => {
    const sale = doc.data();
    totalSales += sale.totalSale || 0;
    totalCost += sale.totalCost || 0;
  });
  
  creditSnap.forEach(doc => {
    const credit = doc.data();
    totalSales += credit.amountPaid || 0;
    totalCost += (credit.costPrice * credit.quantity) || 0;
  });
  
  totalProfit = totalSales - totalCost;
  
  document.getElementById('totalSales').textContent = totalSales.toFixed(2);
  document.getElementById('totalCost').textContent = totalCost.toFixed(2);
  document.getElementById('profit').textContent = totalProfit.toFixed(2);
  
  const profitElement = document.getElementById('profit');
  profitElement.style.color = totalProfit >= 0 ? 'green' : 'red';
}
window.calculateProfit = calculateProfit;

// Group Receipt Generation using Gadendigitech format (no logo)
function generateGroupReceipt(sale) {
  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  };

  const formatCurrency = (amount) => parseFloat(amount).toFixed(2);

  let subtotal = 0;
  const itemsBody = [
    ['Item', 'Barcode', 'Qty', 'Price']
  ];

  sale.items.forEach(item => {
    subtotal += item.price * item.quantity;
    itemsBody.push([
      { text: item || '', fontSize: 5, margin: [0, 0, 0, 0] },
      { text: item.barcode|| '', fontSize: 5, margin: [0, 0, 0, 0] },
      { text: item.quantity.toString(), fontSize: 5, alignment: 'center', margin: [0, 0, 0, 0] },
      { text: formatCurrency(item.price), fontSize: 5, alignment: 'right', margin: [0, 0, 0, 0] }
    ]);
  });

  const vat = subtotal * 0.16;
  const total = subtotal + vat;
  const cash = sale.cash !== undefined ? sale.cash : total;
  const change = (cash - total) > 0 ? (cash - total) : 0;
  const bankCard = sale.bankCard || "";
  const approvalCode = sale.approvalCode || "";

  const docDefinition = {
    pageSize: { width: 227, height: 'auto' }, // ~80mm width
    pageMargins: [10, 10, 10, 10],
    content: [
      { text: 'Gaden Digitech Ltd', style: 'header' },
      { text: 'Paybill:  | Acc: ', style: 'subheader' },
      { text: 'gadendigitech@gmail.com', style: 'subheader' },
      { text: `Receipt #: ${sale.id || ''}`, style: 'small' },
      { text: `Date: ${formatDate(sale.date)}`, style: 'small' },
      { text: `Client: ${sale.clientName}`, style: 'small' },
      { text: '\n' },
      {
        table: {
          widths: [60, '*', 50, 30, 40],
          body: itemsBody
        },
        layout: 'noBorders'
      },
      { text: '\n' },
      {
        table: {
          widths: ['*', 'auto'],
          body: [
            ['Subtotal', formatCurrency(subtotal)],
            ['VAT (16%)', formatCurrency(vat)],
            [{ text: 'TOTAL', bold: true }, { text: formatCurrency(total), bold: true }]
          ]
        },
        layout: 'noBorders'
      },
      { text: '\n' },
      { text: 'Goods sold are not returnable.', style: 'note' },
      { text: 'Served by: ' + (sale.servedBy || 'System'), style: 'note' }
    ],
    styles: {
      header: { fontSize: 10, bold: true, alignment: 'center', margin: [0, 0, 0, 2] },
      subheader: { fontSize: 8, alignment: 'center' },
      small: { fontSize: 8, alignment: 'center' },
      note: { fontSize: 7, italics: true, alignment: 'center' }
    },
    defaultStyle: {
      fontSize: 8
    },
    images: {}
  };

  pdfMake.createPdf(docDefinition).print();
}

// Auto-focus barcode input on page load
window.onload = () => {
  document.getElementById('saleBarcode')?.focus();
  loadCreditSales();
  loadSalesRecords();
  calculateProfit();
};
