// Initialize Firebase (use your config)
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
  window.db = db;
  
  auth.onAuthStateChanged(user => {
    if (!user) {
      window.location = 'index.html';
      return;
    }
    initializeApp();
  });
  
  function initializeApp() {
    loadCreditSales();
    setupFilterButtons();
    setupClearFilterButtons();
    document.getElementById('logoutBtn').onclick = () => { auth.signOut(); };
  }
  
  function setupClearFilterButtons() {
    document.getElementById('clearCreditsFilterButton')?.addEventListener('click', () => {
      document.getElementById('filterCreditsFromDate').value = '';
      document.getElementById('filterCreditsToDate').value = '';
      document.getElementById('filterCreditsClientName').value = '';
      loadCreditSales();
    });
  }
  function setupFilterButtons() {
    document.getElementById('filterCreditsButton')?.addEventListener('click', loadCreditSales);
  }
  
  // --- LOAD CREDIT SALES ---
  async function loadCreditSales() {
    const tbody = document.getElementById('creditSalesTableBody');
    const fromDate = document.getElementById('filterCreditsFromDate')?.value;
    const toDate = document.getElementById('filterCreditsToDate')?.value;
    const nameFilter = document.getElementById('filterCreditsClientName')?.value.trim().toLowerCase();
  
    let records = [];
    let totalOutstanding = 0, totalPaid = 0;
    try {
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
      snapshot.forEach(doc => {
        const sale = doc.data();
        if (!nameFilter || (sale.clientName && sale.clientName.toLowerCase().includes(nameFilter))) {
          records.push({ id: doc.id, ...sale });
          totalOutstanding += sale.balance || 0;
          totalPaid += sale.amountPaid || 0;
        }
      });
    } catch (error) {
      alert("Error loading credit sales.");
      return;
    }
  
    tbody.innerHTML = '';
    if (records.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="13" style="text-align:center;">No credit sales records found.</td>`;
      tbody.appendChild(tr);
      document.getElementById('totalCreditOutstanding').textContent = '0.00';
      document.getElementById('totalCreditPaid').textContent = '0.00';
      return;
    }
    records.forEach(sale => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${sale.date || ''}</td>
        <td>${sale.clientName || ''}</td>
        <td>${sale.clientPhone || ''}</td>
        <td>${sale.category || ''}</td>
        <td>${sale.itemName || ''}</td>
        <td>${sale.scannedBarcode || ''}</td>
        <td>${sale.quantity || ''}</td>
        <td>${sale.creditAmount ? sale.creditAmount.toFixed(2) : ''}</td>
        <td>${sale.amountPaid ? sale.amountPaid.toFixed(2) : ''}</td>
        <td>${sale.balance ? sale.balance.toFixed(2) : ''}</td>
        <td>${sale.dueDate || 'N/A'}</td>
        <td>${sale.status || ''}</td>
        <td>
          <button onclick="payCredit('${sale.id}')">Pay</button>
          <button onclick="editCredit('${sale.id}')">Edit</button>
          <button onclick="deleteCredit('${sale.id}')">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
    document.getElementById('totalCreditOutstanding').textContent = totalOutstanding.toFixed(2);
    document.getElementById('totalCreditPaid').textContent = totalPaid.toFixed(2);
  }
  window.loadCreditSales = loadCreditSales;
  
  // --- PAY CREDIT ---
  async function payCredit(id) {
    const paymentStr = prompt('Enter payment amount:');
    const payment = parseFloat(paymentStr);
    if (isNaN(payment) || payment <= 0) {
      alert('Please enter a valid positive amount.');
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
    const creditAmount = data.creditAmount || 0;
    const newBalance = creditAmount - newAmountPaid;
    if (newBalance < 0) {
      alert('Payment exceeds remaining balance');
      return;
    }
    const newStatus = newBalance <= 0 ? 'Paid' : 'Pending';
    await docRef.update({
      amountPaid: newAmountPaid,
      balance: newBalance,
      status: newStatus,
      lastPaymentDate: new Date().toISOString().split('T')[0]
    });
    if (newBalance <= 0) {
      // Move record to 'sales' when paid
      const paidDoc = await docRef.get();
      const paidData = paidDoc.data();
      await db.collection('sales').add({
        ...paidData,
        saleType: 'credit-paid',
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
      await docRef.delete();
      alert('Credit fully paid — moved to Sales records!');
      loadCreditSales();
    } else {
      alert('Payment recorded!');
      loadCreditSales();
    }
  }
  window.payCredit = payCredit;
  
  // --- EDIT CREDIT SALE ---
  window.editCredit = async function(id) {
    const docRef = db.collection('creditSales').doc(id);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      alert('Credit sale not found');
      return;
    }
    const data = docSnap.data();
    const newDueDate = prompt('Edit Due Date (YYYY-MM-DD):', data.dueDate || '');
    if (newDueDate === null) return;
    const newAmountPaidStr = prompt('Edit Amount Paid:', data.amountPaid || 0);
    if (newAmountPaidStr === null) return;
    const newAmountPaid = parseFloat(newAmountPaidStr);
    if (isNaN(newAmountPaid) || newAmountPaid < 0) {
      alert('Invalid amount paid');
      return;
    }
    if (newAmountPaid > (data.creditAmount || 0)) {
      alert('Paid amount cannot exceed credit amount');
      return;
    }
    const newBalance = (data.creditAmount || 0) - newAmountPaid;
    const newStatus = newBalance <= 0 ? 'Paid' : 'Pending';
    await docRef.update({
      dueDate: newDueDate,
      amountPaid: newAmountPaid,
      balance: newBalance,
      status: newStatus
    });
    alert('Credit sale updated!');
    loadCreditSales();
  };
  
  // --- DELETE CREDIT SALE ---
  window.deleteCredit = async function(id) {
    if (confirm('Are you sure you want to delete this credit sale?')) {
      await db.collection('creditSales').doc(id).delete();
      alert('Credit sale deleted');
      loadCreditSales();
    }
  };
  
  window.onload = () => { loadCreditSales(); };
  