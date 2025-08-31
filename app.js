// Firebase keys (unsafe in frontend)
const firebaseConfig = {
  apiKey: "AIzaSyAkPqrjrXqtdDxxBhLgRXjRfPciw7XtAj4",
  authDomain: "novely-4421d.firebaseapp.com",
  projectId: "novely-4421d",
  storageBucket: "novely-4421d.appspot.com",
  messagingSenderId: "597056434307",
  appId: "1:597056434307:web:xxxxxx"
};

const dbUserId = prompt("Enter your username"); // unique per player
const balanceEl = document.getElementById("balance");
const gameMsg = document.getElementById("gameMsg");

const script1 = document.createElement('script');
script1.src = "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js";
document.head.appendChild(script1);
const script2 = document.createElement('script');
script2.src = "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js";
document.head.appendChild(script2);

script2.onload = () => {
  firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();

  // Ensure user exists
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

  // Deposit
  document.getElementById('depositBtn').addEventListener('click', () => {
    alert("Deposit via ZuriPay or other method here");
  });

  // Withdraw
  document.getElementById('withdrawBtn').addEventListener('click', async () => {
    const doc = await db.collection('users').doc(dbUserId).get();
    let balance = doc.exists ? doc.data().balance : 0;
    if(balance < 3){
      alert("Minimum withdrawal $3");
    } else {
      alert("Withdrawal sent!");
      await db.collection('users').doc(dbUserId).set({ balance:0 });
      balanceEl.textContent = "0.00";
    }
  });

  // Multiplayer 10 cents game
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
      // No one waiting → add self to queue
      await queueRef.set({ user: dbUserId });
      gameMsg.textContent = "Waiting for another player...";
      queueRef.onSnapshot(async snap => {
        const data = snap.data();
        if(data.game && data.game.numberChosen && data.game.guesser){
          if(data.game.guesser === dbUserId){
            handleGame(data.game);
          }
        }
      });
      return;
    }

    // Someone is waiting → match with them
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

    // Timer for 5 seconds
    const timer = setTimeout(async () => {
      if(guess === null){
        guess = 0; // invalid guess counts as wrong
        await processResult(guess, game);
      }
    }, 5000);

    // Prompt for guess
    guess = parseInt(prompt("Guess the number 1-4 (5 seconds)"));
    clearTimeout(timer);
    if(guess === null || isNaN(guess)) guess = 0; // treat cancel as wrong
    await processResult(guess, game);
  }

  async function processResult(guess, game){
    const chooserId = game.chooser;
    const chooserDoc = await db.collection('users').doc(chooserId).get();
    const guesserDoc = await db.collection('users').doc(dbUserId).get();
    let chooserBal = chooserDoc.exists ? chooserDoc.data().balance : 0;
    let guesserBal = guesserDoc.exists ? guesserDoc.data().balance : 0;
    const fee = 0.05 * 0.05;

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

    // Clear game
    await db.collection('queue').doc('waiting').set({ user: null });
  }
};