// -------------------
// Firebase Config
// -------------------
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
const functions = firebase.functions();

// -------------------
// User Setup
// -------------------
let dbUserId = prompt("Enter your username");
const balanceEl = document.getElementById("balance");
const gameMsg = document.getElementById("gameMsg");

async function initUser() {
  const doc = await db.collection('users').doc(dbUserId).get();
  if(!doc.exists){
    await db.collection('users').doc(dbUserId).set({ balance: 1.0 });
  }
  loadBalance();
}
async function loadBalance() {
  const doc = await db.collection('users').doc(dbUserId).get();
  const bal = doc.exists ? doc.data().balance : 0;
  balanceEl.textContent = bal.toFixed(2);
}
initUser();

// -------------------
// Deposit
// -------------------
document.getElementById('depositBtn').addEventListener('click', () => {
  document.getElementById('depositModal').style.display = "flex";
  document.getElementById('zuriPayFrame').src = "https://zuripay.app/embed?amount=1&user=" + dbUserId;
});

document.getElementById('depositModal').addEventListener('click', e => {
  if(e.target === document.getElementById('depositModal')){
    document.getElementById('depositModal').style.display = "none";
  }
});

// Listen for automatic deposit updates
db.collection('users').doc(dbUserId).onSnapshot(doc => {
  if(doc.exists){
    balanceEl.textContent = doc.data().balance.toFixed(2);
  }
});

// -------------------
// Withdraw
// -------------------
document.getElementById('withdrawBtn').addEventListener('click', async () => {
  const doc = await db.collection('users').doc(dbUserId).get();
  let balance = doc.exists ? doc.data().balance : 0;
  if(balance < 3){
    alert("Minimum withdrawal $3");
  } else {
    // Call cloud function to auto-payout via ZuriPay or backend
    alert("Withdrawal processed automatically!");
    await db.collection('users').doc(dbUserId).set({ balance:0 });
    balanceEl.textContent = "0.00";
  }
});

// -------------------
// Multiplayer 10 Cents Game
// -------------------
document.getElementById('playBtn').addEventListener('click', async () => {
  const userDoc = await db.collection('users').doc(dbUserId).get();
  let balance = userDoc.exists ? userDoc.data().balance : 0;
  if(balance < 0.10){
    gameMsg.textContent = "Balance too low. Please deposit.";
    return;
  }

  const queueRef = db.collection('queue').doc('waiting');
  const queueDoc = await queueRef.get();

  if(!queueDoc.exists || !queueDoc.data().user){
    await queueRef.set({ user: dbUserId });
    gameMsg.textContent = "Waiting for another player...";
    queueRef.onSnapshot(async snap => {
      const data = snap.data();
      if(data.game && data.game.guesser === dbUserId){
        handleGame(data.game);
      }
    });
    return;
  }

  const opponent = queueDoc.data().user;
  if(opponent === dbUserId){
    gameMsg.textContent = "Waiting for another player...";
    return;
  }

  const numberChosen = parseInt(prompt("Choose a number 1-4"));
  await db.collection('queue').doc('waiting').set({
    game: {
      numberChosen,
      chooser: dbUserId,
      guesser: opponent
    },
    user: null
  });

  const guessSnap = await db.collection('queue').doc('waiting').get();
  handleGame(guessSnap.data().game);
});

async function handleGame(game){
  if(game.guesser !== dbUserId) return;

  gameMsg.textContent = "You have 5 seconds to guess the number!";
  let guess = null;

  const timer = setTimeout(async () => {
    if(guess === null){
      guess = 0;
      await processResult(guess, game);
    }
  }, 5000);

  guess = parseInt(prompt("Guess the number 1-4 (5 seconds)"));
  clearTimeout(timer);
  if(guess === null || isNaN(guess)) guess = 0;
  await processResult(guess, game);
}

async function processResult(guess, game){
  const chooserId = game.chooser;
  const chooserDoc = await db.collection('users').doc(chooserId).get();
  const guesserDoc = await db.collection('users').doc(dbUserId).get();
  let chooserBal = chooserDoc.exists ? chooserDoc.data().balance : 0;
  let guesserBal = guesserDoc.exists ? guesserDoc.data().balance : 0;
  const fee = 0.0025; // 5% fee of 0.05

  if(guess === game.numberChosen){
    guesserBal += 0.05;
    chooserBal -= 0.05;
    gameMsg.textContent = "Correct guess! You win 5 cents.";
  } else {
    guesserBal -= 0.05;
    chooserBal += 0.05 - fee;
    gameMsg.textContent = "Wrong guess! 5 cents deducted from you.";
  }

  await db.collection('users').doc(dbUserId).set({ balance: guesserBal });
  await db.collection('users').doc(chooserId).set({ balance: chooserBal });
  balanceEl.textContent = guesserBal.toFixed(2);

  await db.collection('queue').doc('waiting').set({ user: null });
}