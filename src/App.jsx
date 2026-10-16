import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc 
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged 
} from 'firebase/auth';
import { 
  Crown, PlusCircle, LogIn, AlertCircle, BookOpen, RefreshCw, 
  Copy, Check, UserPlus, Trash2, Play, ChevronUp, ChevronDown, 
  History, Trophy, CheckCircle2, Sigma, ShieldCheck, LogOut
} from 'lucide-react';

const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : {
      apiKey: "AIzaSyCNiSLCVm-oHyJ5AE_NrzWKVT2CMB-rAzE",
      authDomain: "wizard-web-c5c66.firebaseapp.com",
      projectId: "wizard-web-c5c66",
      storageBucket: "wizard-web-c5c66.firebasestorage.app",
      messagingSenderId: "306669033759",
      appId: "1:306669033759:web:b84d787066cf766aef382a",
      measurementId: "G-71BY730TPW"
    };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
// Use explicit __app_id if provided, otherwise default to the Firebase projectId (more robust)
const appId = typeof __app_id !== 'undefined' ? __app_id : (firebaseConfig?.projectId || 'wizard-scorekeeper');

const generateRoomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Wizard Scoring: +20 for exact bid, +10 per trick. -10 per trick diff if missed.
const calculateScore = (bid, taken) => {
  const bidNum = Number(bid || 0);
  const takenNum = Number(taken || 0);
  if (bidNum === takenNum) {
    return 20 + (bidNum * 10);
  } else {
    return -10 * Math.abs(takenNum - bidNum);
  }
};

export default function App() {
  const [user, setUser] = useState(null);
  const [roomCode, setRoomCode] = useState('');
  const [hostName, setHostName] = useState('');
  const [manualPlayerInput, setManualPlayerInput] = useState('');
  const [joinRole, setJoinRole] = useState('spectator');
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [spectatorName, setSpectatorName] = useState('');

  const [pendingInviteCode, setPendingInviteCode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room');
  });

  const [gameData, setGameData] = useState(null);
  const [activeTab, setActiveTab] = useState('input'); // 'input' | 'history'
  const [copiedCode, setCopiedCode] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showRulesModal, setShowRulesModal] = useState(false);

  // Local state for recording tricks before submitting
  const [currentTricks, setCurrentTricks] = useState({});
  const [assignedPlayerId, setAssignedPlayerId] = useState(null);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth initialization error:", err);
        setErrorMessage('Auth initialization error: ' + (err?.message || err));
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (usr) => {
      setUser(usr);
    });
    return () => unsubscribe();
  }, []);

  // Helper to ensure we have an authenticated user before writes
  const ensureAuthenticated = async () => {
    if (auth.currentUser) return auth.currentUser;
    try {
      let cred;
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        cred = await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        cred = await signInAnonymously(auth);
      }
      // signIn returns a UserCredential; return the user directly to avoid timing issues
      console.debug('ensureAuthenticated signed in', cred.user?.uid);
      return cred.user;
    } catch (err) {
      console.error('Authentication error:', err);
      setErrorMessage('Authentication failed: ' + (err?.message || err));
      return null;
    }
  };

  // Realtime listener: subscribe based on roomCode alone so UI updates even if auth hasn't finished
  useEffect(() => {
    if (!roomCode) return;

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'wizard_rooms', roomCode.toUpperCase());

    console.debug('Setting up room snapshot listener for', roomRef.path);

    const unsubscribe = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setGameData(data);

        // Keep local trick state in sync if host updates it
        if (data.tricks) setCurrentTricks(prev => ({ ...data.tricks, ...prev }));

        // Map current user to a claimed player slot if we have a user
        const myUid = user?.uid;
        if (myUid) {
          const linkedPlayer = data.players?.find(p => p.claimedByUid === myUid);
          if (linkedPlayer) {
            setAssignedPlayerId(linkedPlayer.id);
          } else {
            // clear mapping if user no longer claims a slot
            setAssignedPlayerId(null);
          }
        }
      } else {
        setErrorMessage('Game room not found. Check your 4-character room code.');
        setGameData(null);
      }
    }, (error) => {
      console.error("Room sync error:", error);
      setErrorMessage('Syncing error. Please check your connection.');
    });

    return () => {
      console.debug('Tearing down room listener for', roomRef.path);
      unsubscribe();
    };
  }, [roomCode, user]);

  useEffect(() => {
    const autoJoin = async () => {
      if (user && pendingInviteCode) {
        const code = pendingInviteCode.toUpperCase();
        setPendingInviteCode(null);
        try {
          const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'wizard_rooms', code);
          const docSnap = await getDoc(roomRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            const newSpectator = {
              uid: user.uid,
              name: 'Watcher ' + Math.floor(Math.random() * 90 + 10)
            };
            const updatedSpectators = [...(data.spectators || []).filter(s => s.uid !== user.uid), newSpectator];
            await updateDoc(roomRef, { spectators: updatedSpectators });
            
            setRoomCode(code);
            setJoinRole('spectator');
            setActiveTab('input');
            window.history.replaceState({}, document.title, window.location.pathname);
          } else {
            setErrorMessage('Invite link room not found.');
            setRoomCode('');
          }
        } catch (err) {
          console.error(err);
          setErrorMessage('Unable to auto-join room from invite link. ' + (err?.message || ''));
        }
      }
    };
    autoJoin();
  }, [user, pendingInviteCode]);

  const handleCreateRoom = async () => {
    if (!hostName.trim()) {
      setErrorMessage('Please enter Host / Dealer name.');
      return;
    }
    setErrorMessage('');

    // Ensure authentication before attempting writes; Firestore rules often require request.auth
    const userObj = await ensureAuthenticated();
    if (!userObj) return; // error already set in ensureAuthenticated

    // Mirror auth immediately in local state so UI recognizes us as host
    setUser(userObj);

    const newCode = generateRoomCode();
    const myUid = userObj.uid;
    const initialHostPlayerId = 'p_' + Date.now();

    const initialRoomData = {
      code: newCode,
      createdAt: Date.now(),
      hostUid: myUid,
      status: 'lobby', 
      players: [
        { id: initialHostPlayerId, name: hostName.trim(), isHost: true, claimedByUid: myUid }
      ],
      spectators: [],
      currentRound: 1,
      maxRounds: 10,
      roundsHistory: [],
      bids: {},
      tricks: {},
      dealerIndex: 0
    };

    try {
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'wizard_rooms', newCode);
      await setDoc(roomRef, initialRoomData);
      console.debug('Room created:', roomRef.path);
      setRoomCode(newCode);
      setAssignedPlayerId(initialHostPlayerId);
      // Optimistically set local gameData so creator is immediately recognized as host
      setGameData(initialRoomData);
    } catch (err) {
      console.error("Error creating room:", err);
      setErrorMessage('Failed to create room: ' + (err?.message || err));
    }
  };

  const handleAddPlayer = async () => {
    if (!gameData || !manualPlayerInput.trim()) return;
    if (gameData.players.length >= 6) {
      setErrorMessage('Wizard supports up to 6 players maximum.');
      return;
    }
    setErrorMessage('');

    const newPlayerId = 'p_' + (Date.now() % 100000);
    const newPlayer = {
      id: newPlayerId,
      name: manualPlayerInput.trim(),
      isHost: false,
      claimedByUid: null
    };

    const updatedPlayers = [...gameData.players, newPlayer];
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'wizard_rooms', gameData.code);
    const calculatedMaxRounds = Math.floor(60 / updatedPlayers.length);

    await updateDoc(roomRef, {
      players: updatedPlayers,
      maxRounds: gameData.status === 'lobby' ? calculatedMaxRounds : gameData.maxRounds
    });
    setManualPlayerInput('');
  };

  const handleRemovePlayer = async (pId) => {
    if (!gameData) return;
    const updatedPlayers = gameData.players.filter(p => p.id !== pId);
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'wizard_rooms', gameData.code);
    const calculatedMaxRounds = Math.max(1, Math.floor(60 / (updatedPlayers.length || 1)));

    await updateDoc(roomRef, {
      players: updatedPlayers,
      maxRounds: gameData.status === 'lobby' ? calculatedMaxRounds : gameData.maxRounds
    });
  };

  const handleReorderPlayer = async (index, direction) => {
    if (!gameData) return;
    const newPlayers = [...gameData.players];
    
    if (direction === 'up' && index > 0) {
      [newPlayers[index - 1], newPlayers[index]] = [newPlayers[index], newPlayers[index - 1]];
    } else if (direction === 'down' && index < newPlayers.length - 1) {
      [newPlayers[index + 1], newPlayers[index]] = [newPlayers[index], newPlayers[index + 1]];
    } else {
      return; // Invalid move
    }

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'wizard_rooms', gameData.code);
    await updateDoc(roomRef, { players: newPlayers });
  };

  const handleJoinRoom = async () => {
    if (!roomCode.trim()) {
      setErrorMessage('Please enter a 4-letter room code.');
      return;
    }
    setErrorMessage('');
    const formattedCode = roomCode.trim().toUpperCase();

    // Ensure authenticated for writes
    const userObj = await ensureAuthenticated();
    if (!userObj) return;
    // Mirror auth locally immediately so subsequent UI checks see us as authenticated
    setUser(userObj);
    const myUid = userObj.uid;

    try {
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'wizard_rooms', formattedCode);
      const docSnap = await getDoc(roomRef);

      if (!docSnap.exists()) {
        setErrorMessage('Room code not found. Verify code with host.');
        return;
      }

      const data = docSnap.data();

      if (joinRole === 'spectator') {
        const newSpectator = {
          uid: myUid,
          name: spectatorName.trim() || 'Watcher ' + Math.floor(Math.random() * 90 + 10)
        };
        const updatedSpectators = [...(data.spectators || []).filter(s => s.uid !== myUid), newSpectator];
        await updateDoc(roomRef, { spectators: updatedSpectators });
        setAssignedPlayerId(null);
      } else if (joinRole === 'player') {
        if (!selectedPlayerId) {
          setErrorMessage('Please select which table player slot to claim.');
          return;
        }
        const updatedPlayers = data.players.map(p => {
          if (p.id === selectedPlayerId) {
            return { ...p, claimedByUid: myUid };
          }
          return p;
        });
        await updateDoc(roomRef, { players: updatedPlayers });
        setAssignedPlayerId(selectedPlayerId);
      }

      setRoomCode(formattedCode);
      setActiveTab('input');
    } catch (err) {
      console.error("Error joining room:", err);
      setErrorMessage('Unable to join room: ' + (err?.message || err));
    }
  };

  const handleStartGame = async () => {
    if (!gameData) return;
    if (gameData.players.length < 2) {
      setErrorMessage('Need at least 2 players at the table to start!');
      return;
    }
    const maxRounds = Math.floor(60 / gameData.players.length);
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'wizard_rooms', gameData.code);

    await updateDoc(roomRef, {
      status: 'bidding',
      currentRound: 1,
      maxRounds: maxRounds,
      dealerIndex: 0,
      bids: {},
      tricks: {},
      roundsHistory: []
    });
    setActiveTab('input');
  };

  const handleBidSubmit = async (pId, bidVal) => {
    if (!gameData) return;
    const updatedBids = { ...(gameData.bids || {}), [pId]: bidVal };
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'wizard_rooms', gameData.code);
    await updateDoc(roomRef, { bids: updatedBids });
  };

  const handleEndBidding = async () => {
    if (!gameData) return;
    const allBidded = gameData.players.every(p => gameData.bids && gameData.bids[p.id] !== undefined);
    if (!allBidded) {
      setErrorMessage('All players must place a bid before ending the bidding phase.');
      return;
    }
    setErrorMessage('');
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'wizard_rooms', gameData.code);
    await updateDoc(roomRef, { status: 'playing' });
  };

  const handleTricksSubmit = async () => {
    if (!gameData) return;

    const totalTricksEntered = Object.values(currentTricks).reduce((a, b) => a + Number(b || 0), 0);
    if (totalTricksEntered !== gameData.currentRound) {
      setErrorMessage(`Total tricks won (${totalTricksEntered}) must exactly equal the total dealt cards in Round ${gameData.currentRound}!`);
      return;
    }
    setErrorMessage('');

    const roundScores = {};
    const lastCumulative = gameData.roundsHistory.length > 0 
      ? gameData.roundsHistory[gameData.roundsHistory.length - 1].cumulative
      : {};
    const nextCumulative = {};

    gameData.players.forEach(p => {
      const bid = gameData.bids[p.id] ?? 0;
      const taken = Number(currentTricks[p.id] || 0);
      const points = calculateScore(bid, taken);
      roundScores[p.id] = points;
      const prevTotal = lastCumulative[p.id] || 0;
      nextCumulative[p.id] = prevTotal + points;
    });

    const newHistoryEntry = {
      roundNum: gameData.currentRound,
      cards: gameData.currentRound,
      bids: { ...gameData.bids },
      tricks: { ...currentTricks },
      scores: roundScores,
      cumulative: nextCumulative
    };

    const newHistory = [...gameData.roundsHistory, newHistoryEntry];
    const isGameOver = gameData.currentRound >= gameData.maxRounds;

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'wizard_rooms', gameData.code);
    await updateDoc(roomRef, {
      roundsHistory: newHistory,
      currentRound: isGameOver ? gameData.currentRound : gameData.currentRound + 1,
      dealerIndex: (gameData.dealerIndex + 1) % gameData.players.length,
      status: isGameOver ? 'finished' : 'bidding',
      bids: {},
      tricks: {}
    });

    setCurrentTricks({});
  };

  const handleResetGame = async () => {
    if (!gameData) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'wizard_rooms', gameData.code);
    await updateDoc(roomRef, {
      status: 'lobby',
      currentRound: 1,
      roundsHistory: [],
      bids: {},
      tricks: {}
    });
    setActiveTab('input');
  };

  const copyCodeToClipboard = () => {
    if (!gameData) return;
    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${gameData.code}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleExitGame = () => {
    setRoomCode('');
    setGameData(null);
    setAssignedPlayerId(null);
    setCurrentTricks({});
    setErrorMessage('');
    setActiveTab('input');
  };

  const myUid = user ? user.uid : null;
  const isHost = gameData && gameData.hostUid === myUid;
  const isSpectator = gameData && !isHost && !assignedPlayerId;

  if (!gameData) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans antialiased relative overflow-hidden">
        <header className="border-b border-indigo-900/40 bg-slate-900/80 backdrop-blur-md p-4">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-tr from-amber-500 to-amber-300 rounded-xl shadow-lg">
                <Crown className="w-6 h-6 text-slate-950" />
              </div>
              <div>
                <h1 className="font-bold text-xl text-amber-50">Wizard Scorekeeper</h1>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-md mx-auto w-full px-4 py-8 flex-1 flex flex-col justify-center">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">
            {errorMessage && (
              <div className="p-3 rounded-xl bg-red-950/80 border border-red-500/40 text-red-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> <span>{errorMessage}</span>
              </div>
            )}

