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

let userId = "user1";
const balanceEl = document.getElementById("balance");
const gameMsg = document.getElementById("gameMsg");

function loadBalance() {
  db.collection("users").doc(userId).get().then(doc => {
    if(doc.exists) {
      balanceEl.textContent = doc.data().balance.toFixed(2);
    } else {
      db.collection("users").doc(userId).set({balance:0});
      balanceEl.textContent = "0.00";
    }
  });
}
loadBalance();

document.getElementById("playBtn").addEventListener("click", () => {
  db.collection("users").doc(userId).get().then(doc => {
    let bal = doc.data().balance;
    if(bal < 0.10){
      gameMsg.textContent = "Insufficient balance, deposit more!";
      return;
    }
    let picker = Math.floor(Math.random()*4)+1;
    let guess = Math.floor(Math.random()*4)+1;
    let fee = 0.05;
    let win = 0.05;
    let lose = 0.05 + fee;

    if(guess === picker){
      bal += win;
      gameMsg.textContent = `You guessed correctly! +$${win.toFixed(2)}`;
    } else {
      bal -= lose;
      gameMsg.textContent = `Wrong guess! -$${lose.toFixed(2)} (5% fee collected)`;
      db.collection("users").doc("admin").get().then(a => {
        let adminBal = a.exists ? a.data().balance : 0;
        db.collection("users").doc("admin").set({balance: adminBal + fee});
      });
    }
    db.collection("users").doc(userId).set({balance: bal});
    balanceEl.textContent = bal.toFixed(2);
  });
});

document.getElementById("depositBtn").addEventListener("click", () => {
  document.getElementById("depositModal").style.display = "flex";
  document.getElementById("zuriPayFrame").src = "https://zuripay.app/embed?amount=1&user="+userId;
});

document.getElementById("depositModal").addEventListener("click", e => {
  if(e.target === document.getElementById("depositModal")){
    document.getElementById("depositModal").style.display = "none";
  }
});

document.getElementById("withdrawBtn").addEventListener("click", () => {
  db.collection("users").doc(userId).get().then(doc => {
    let bal = doc.data().balance;
    if(bal < 3){
      alert("Minimum withdrawal is $3");
    } else {
      alert("Withdrawal request sent!");
      db.collection("users").doc(userId).set({balance:0});
      balanceEl.textContent = "0.00";
    }
  });
});