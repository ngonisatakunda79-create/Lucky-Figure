// ---------- FIREBASE CLIENT CONFIG ----------
const firebaseConfig = {
  apiKey: "AIzaSyAkPqrjrXqtdDxxBhLgRXjRfPciw7XtAj4",
  authDomain: "novely-4421d.firebaseapp.com",
  projectId: "novely-4421d",
  storageBucket: "novely-4421d.appspot.com",
  messagingSenderId: "597056434307",
  appId: "1:597056434307:web:xxxxxx"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// ---------- UI ----------
const loginBtn = document.getElementById('loginBtn');
const usernameInput = document.getElementById('usernameInput');
const displayUsername = document.getElementById('display-username');
const logoutBtn = document.getElementById('logoutBtn');
const balanceEl = document.getElementById('balance');
const depositBtn = document.getElementById('depositBtn');
const playBtn = document.getElementById('playBtn');
const status = document.getElementById('status');
const gameSection = document.getElementById('game');
const authSection = document.getElementById('auth');
const gameUI = document.getElementById('gameUI');
const roleText = document.getElementById('roleText');
const chooseNumber = document.getElementById('chooseNumber');
const guessNumber = document.getElementById('guessNumber');
const numbersDiv = document.getElementById('numbers');
const guessesDiv = document.getElementById('guesses');
const cancelBtn = document.getElementById('cancelBtn');

let currentUserId = null;
let unsubscribeBalance = null;
let waitingDocRef = null;
let currentGameRef = null;

// helpers
function setStatus(s){ status.innerText = s; }
function toMoney(n){ return Number(n).toFixed(2); }

// login (simple)
loginBtn.onclick = async () => {
  const username = usernameInput.value.trim();
  if(!username) return alert('Enter username');
  // We'll sign in anonymously and store username in user doc
  const userCredential = await auth.signInAnonymously();
  currentUserId = userCredential.user.uid;
  await db.collection('users').doc(currentUserId).set({
    username, balance: 0
  }, { merge: true });
  displayUsername.innerText = username;
  authSection.classList.add('hidden');
  gameSection.classList.remove('hidden');
  logoutBtn.classList.remove('hidden');
  listenBalance();
};

// logout
logoutBtn.onclick = async ()=> {
  if(unsubscribeBalance) unsubscribeBalance();
  await auth.signOut();
  currentUserId = null;
  displayUsername.innerText = 'Guest';
  authSection.classList.remove('hidden');
  gameSection.classList.add('hidden');
  logoutBtn.classList.add('hidden');
};

// listen for balance changes
function listenBalance(){
  if(!currentUserId) return;
  const userRef = db.collection('users').doc(currentUserId);
  unsubscribeBalance = userRef.onSnapshot(doc=>{
    if(!doc.exists) {
      userRef.set({balance:0, username: displayUsername.innerText});
      balanceEl.innerText = '0.00';
      return;
    }
    const data = doc.data();
    balanceEl.innerText = toMoney(data.balance || 0);
    if((data.balance || 0) < 0.10){
      // redirect to deposit (UI hint)
      setStatus('Low balance — deposit to play.');
    } else {
      setStatus('');
    }
  });
}

// ---------- DEPOSIT (start payment) ----------
// This calls Netlify function /api/create-payment which uses ZuriPay secret (kept secure)
depositBtn.onclick = async ()=>{
  if(!currentUserId) return alert('Please login first');
  // call serverless function to create payment
  try{
    // amount is 3.00 min deposit
    const res = await fetch('/.netlify/functions/create-payment', {
      method:'POST',
      headers:{ 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 3.00,
        currency: 'USD',
        method: 'ecocash', // let user choose later, set ecocash default for now
        userId: currentUserId
      })
    });
    const data = await res.json();
    if(data.checkoutUrl){
      // open hosted checkout or payment page returned by ZuriPay
      window.open(data.checkoutUrl, '_blank');
      setStatus('Deposit started — complete payment in the new tab.');
    } else {
      alert('Failed to create payment: ' + (data.error || 'unknown'));
    }
  }catch(err){
    console.error(err);
    alert('Error creating payment');
  }
};

// ---------- MATCHMAKING & GAME ----------
/*
Flow:
- Player clicks Play -> create a 'waiting' doc with userId + ts
- Query for another waiting doc (not self) -> use transaction to claim both and create a 'games' doc
- Game doc contains playerA, playerB, state
- Player roles: randomly pick who chooses the number (picker) and who guesses (guesser)
- Picker picks number 1..4; guesser has 5s to guess or cancel
- On result, update balances via a serverless function or client-side transaction (we'll do a secure server call to transfer to prevent client tampering)
*/
playBtn.onclick = async ()=>{
  if(!currentUserId) return alert('Login first');
  // check balance
  const userDoc = await db.collection('users').doc(currentUserId).get();
  const bal = (userDoc.exists && userDoc.data().balance) || 0;
  if(bal < 0.10){ setStatus('Insufficient balance — deposit'); return; }

  setStatus('Searching for opponent...');
  // create waiting doc
  const waitingRef = db.collection('waiting').doc();
  await waitingRef.set({ userId: currentUserId, ts: firebase.firestore.FieldValue.serverTimestamp() });

  // try to find another waiting user
  const q = await db.collection('waiting')
    .where('userId','!=', currentUserId)
    .orderBy('ts','asc')
    .limit(1)
    .get();

  if(q.empty){
    setStatus('No players available right now.');
    // leave the waiting doc for others (or remove after x seconds)
    setTimeout(()=> waitingRef.delete().catch(()=>{}), 10000);
    return;
  }

  // found candidate
  const otherDoc = q.docs[0];
  // create game in a transaction that deletes both waiting docs and creates a game
  const otherRef = db.collection('waiting').doc(otherDoc.id);
  const gameRef = db.collection('games').doc();
  try{
    await db.runTransaction(async tx=>{
      const aSnap = await tx.get(waitingRef);
      const bSnap = await tx.get(otherRef);
      if(!aSnap.exists || !bSnap.exists) throw "Opponent gone";

      tx.delete(waitingRef);
      tx.delete(otherRef);

      const playerA = aSnap.data().userId;
      const playerB = bSnap.data().userId;

      // randomly choose who is picker
      const picker = Math.random() < 0.5 ? playerA : playerB;
      const guesser = picker === playerA ? playerB : playerA;

      tx.set(gameRef, {
        playerA, playerB, picker, guesser,
        state: 'awaiting_pick', // awaiting_pick, awaiting_guess, finished
        created: firebase.firestore.FieldValue.serverTimestamp()
      });
    });

    setStatus('Matched! Starting game...');
    observeGame(gameRef.id);
  }catch(err){
    console.error(err);
    setStatus('Failed to create match. Try again.');
  }
};

// observe game doc for this user
function observeGame(gameId){
  gameUI.classList.remove('hidden');
  setStatus('Game started');
  const gameRef = db.collection('games').doc(gameId);
  currentGameRef = gameRef;
  const unsub = gameRef.onSnapshot(async snap=>{
    if(!snap.exists) { setStatus('Game ended'); gameUI.classList.add('hidden'); unsub(); return; }
    const g = snap.data();
    // if this user is picker
    if(g.picker === currentUserId && g.state === 'awaiting_pick'){
      roleText.innerText = 'You are the picker — pick a number';
      chooseNumber.classList.remove('hidden');
      guessNumber.classList.add('hidden');
      // render buttons
      numbersDiv.innerHTML = '';
      for(let i=1;i<=4;i++){
        const btn = document.createElement('button');
        btn.innerText = i;
        btn.onclick = ()=> pickNumber(gameRef.id, i);
        numbersDiv.appendChild(btn);
      }
    } else if(g.guesser === currentUserId && g.state === 'awaiting_pick'){
      roleText.innerText = 'Opponent is picking...';
      chooseNumber.classList.add('hidden');
      guessNumber.classList.add('hidden');
    } else if(g.guesser === currentUserId && g.state === 'awaiting_guess'){
      roleText.innerText = 'You are the guesser — guess the number';
      chooseNumber.classList.add('hidden');
      guessNumber.classList.remove('hidden');
      guessesDiv.innerHTML = '';
      for(let i=1;i<=4;i++){
        const btn = document.createElement('button');
        btn.innerText = i;
        btn.onclick = ()=> guessNumber(gameRef.id, i);
        guessesDiv.appendChild(btn);
      }
      cancelBtn.onclick = ()=> cancelGame(gameRef.id);
      // auto timeout 5s: handled server-side is better; here we do client fallback
      setTimeout(()=> { setStatus('Time up — cancelling'); cancelGame(gameRef.id); }, 6000);
    } else if(g.state === 'finished'){
      // show result
      roleText.innerText = `Game finished. ${g.result}`;
      chooseNumber.classList.add('hidden');
      guessNumber.classList.add('hidden');
      // remove UI after short delay
      setTimeout(()=> { gameUI.classList.add('hidden'); setStatus('Back to main'); }, 4500);
      unsub();
    }
  });
}

// picker picks number
async function pickNumber(gameId, num){
  const gameRef = db.collection('games').doc(gameId);
  await gameRef.update({ pickedNumber: num, state: 'awaiting_guess', pickTs: firebase.firestore.FieldValue.serverTimestamp() });
  setStatus('Number picked — waiting for guesser');
}

// guesser guesses
async function guessNumber(gameId, guess){
  const gameRef = db.collection('games').doc(gameId);
  // run a transaction to settle payment safely (we call serverless transfer to update balances securely)
  try{
    // call serverless function settle-game for server to move funds
    const res = await fetch('/.netlify/functions/settle-game', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ gameId, guess, userId: currentUserId })
    });
    const data = await res.json();
    if(data.success){
      setStatus('Result processed: ' + data.message);
    } else {
      setStatus('Error processing result: ' + (data.error || 'unknown'));
    }
  }catch(err){
    console.error(err);
    setStatus('Error contacting server to settle game');
  }
}

// cancel
async function cancelGame(gameId){
  try{
    await db.collection('games').doc(gameId).update({ state: 'finished', result: 'Cancelled' });
    setStatus('Game cancelled');
  }catch(e){ console.error(e) }
}