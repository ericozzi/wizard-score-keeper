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
const appId = typeof __app_id !== 'undefined' ? __app_id : 'wizard-scorekeeper';

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
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (usr) => {
      setUser(usr);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !roomCode) return;

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'wizard_rooms', roomCode.toUpperCase());

    const unsubscribe = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setGameData(data);

        // Keep local trick state in sync if host updates it
        if (data.tricks) setCurrentTricks(prev => ({ ...data.tricks, ...prev }));

        // Map current user to a claimed player slot
        const myUid = user.uid;
        const linkedPlayer = data.players?.find(p => p.claimedByUid === myUid);
        if (linkedPlayer) {
          setAssignedPlayerId(linkedPlayer.id);
        }
      } else {
        setErrorMessage('Game room not found. Check your 4-character room code.');
        setGameData(null);
      }
    }, (error) => {
      console.error("Room sync error:", error);
      setErrorMessage('Syncing error. Please check your connection.');
    });

    return () => unsubscribe();
  }, [user, roomCode]);

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
          setErrorMessage('Unable to auto-join room from invite link.');
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

    const newCode = generateRoomCode();
    const myUid = user ? user.uid : 'host_' + Math.random().toString(36).substr(2, 9);
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
      setRoomCode(newCode);
      setAssignedPlayerId(initialHostPlayerId);
    } catch (err) {
      console.error("Error creating room:", err);
      setErrorMessage('Failed to create room.');
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
    const myUid = user ? user.uid : 'user_' + Math.random().toString(36).substr(2, 9);

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
      setErrorMessage('Unable to join room.');
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

            <div className="space-y-4">
              <h2 className="text-lg font-bold text-amber-300 flex items-center gap-2">
                <PlusCircle className="w-5 h-5"/> Create a Game
              </h2>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Host Name</label>
                <input
                  type="text"
                  placeholder="Your Name..."
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  maxLength={16}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-amber-400 rounded-xl px-4 py-3 text-slate-100 text-sm outline-none"
                />
              </div>
              <button
                onClick={handleCreateRoom}
                className="w-full py-3 px-4 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl transition-all shadow-md"
              >
                Create Game Table
              </button>
            </div>

            <div className="flex items-center py-2">
              <div className="flex-grow border-t border-slate-800"></div>
              <span className="mx-4 text-[10px] text-slate-500 uppercase font-bold">Or Join Game</span>
              <div className="flex-grow border-t border-slate-800"></div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Room Code</label>
                <input
                  type="text"
                  placeholder="4-LETTER CODE"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  maxLength={4}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-3 text-center font-mono font-bold text-lg text-indigo-300 uppercase outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setJoinRole('spectator')}
                  className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-all ${
                    joinRole === 'spectator' ? 'bg-indigo-900/60 border-indigo-500 text-indigo-200' : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  Spectate (Watch)
                </button>
                <button
                  type="button"
                  onClick={() => setJoinRole('player')}
                  className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-all ${
                    joinRole === 'player' ? 'bg-indigo-900/60 border-indigo-500 text-indigo-200' : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  Table Player
                </button>
              </div>
              <button
                onClick={handleJoinRoom}
                className="w-full py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl border border-slate-700 transition-all flex items-center justify-center gap-2 text-sm"
              >
                <LogIn className="w-4 h-4" /> Join Room
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const players = gameData.players || [];
  const roundsHistory = gameData.roundsHistory || [];
  const latestScores = roundsHistory.length > 0 
    ? roundsHistory[roundsHistory.length - 1].cumulative 
    : {};

  const leaderboard = [...players].sort((a, b) => (latestScores[b.id] || 0) - (latestScores[a.id] || 0));
  const currentDealer = players[gameData.dealerIndex % (players.length || 1)] || players[0];
  const allBidsIn = players.every(p => gameData.bids && gameData.bids[p.id] !== undefined);
  
  // Calculate Totals for Sticky Footer
  const totalBidsSum = Object.values(gameData.bids || {}).reduce((a, b) => a + Number(b), 0);
  const totalTricksSum = Object.values(currentTricks || {}).reduce((a, b) => a + Number(b || 0), 0);
  const isValidTricksSum = totalTricksSum === gameData.currentRound;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur-md sticky top-0 z-40 p-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-amber-500 rounded-lg text-slate-950">
              <Crown className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-200 text-xs">ROOM</span>
                <span className="font-mono font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20 text-xs">
                  {gameData.code}
                </span>
                <button onClick={copyCodeToClipboard} className="text-slate-400 hover:text-amber-300 flex items-center gap-1 ml-1 bg-slate-800/50 px-2 py-1 rounded transition-colors">
                  {copiedCode ? (
                    <><Check className="w-3.5 h-3.5 text-green-400" /> <span className="text-xs text-green-400 font-medium">Link Copied!</span></>
                  ) : (
                    <><Copy className="w-3.5 h-3.5" /> <span className="text-xs font-medium">Copy Link</span></>
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={() => setShowRulesModal(true)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-amber-300">
              <BookOpen className="w-4 h-4" /> Rules
            </button>
            {isHost && (
              <button onClick={handleResetGame} className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-400">
                <RefreshCw className="w-4 h-4" /> Reset
              </button>
            )}
            <button onClick={handleExitGame} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 ml-2 border-l border-slate-700 pl-3">
              <LogOut className="w-4 h-4" /> Exit
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto w-full p-4 flex-1 flex flex-col gap-4 relative">
        
        {errorMessage && (
          <div className="p-3 rounded-xl bg-red-950/80 border border-red-500/40 text-red-200 text-xs flex items-center justify-between">
            <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {errorMessage}</span>
            <button onClick={() => setErrorMessage('')} className="text-red-400">✕</button>
          </div>
        )}

        {gameData.status === 'lobby' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-xl mx-auto w-full shadow-lg">
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-amber-300">Game Lobby</h2>
              <p className="text-xs text-slate-400 mt-1">Host: Add and reorder players before starting.</p>
            </div>

            {isHost && (
              <div className="flex gap-2 mb-6">
                <input
                  type="text"
                  placeholder="New player name..."
                  value={manualPlayerInput}
                  onChange={(e) => setManualPlayerInput(e.target.value)}
                  maxLength={16}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 outline-none"
                />
                <button
                  onClick={handleAddPlayer}
                  disabled={players.length >= 6}
                  className="py-2 px-4 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-xs rounded-xl flex items-center gap-1"
                >
                  <UserPlus className="w-4 h-4" /> Add
                </button>
              </div>
            )}

            <div className="space-y-2 mb-6">
              <div className="flex justify-between text-xs text-slate-400 font-semibold px-1">
                <span>PLAYERS ({players.length}/6)</span>
                <span>ROUNDS: {gameData.maxRounds}</span>
              </div>
              {players.map((p, idx) => (
                <div key={p.id} className="flex items-center justify-between p-3 bg-slate-950 rounded-xl border border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-amber-300">
                      {idx + 1}
                    </div>
                    <span className="font-semibold text-slate-200">{p.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {isHost && (
                      <>
                        <button onClick={() => handleReorderPlayer(idx, 'up')} disabled={idx === 0} className="p-1 text-slate-400 hover:text-white disabled:opacity-30">
                          <ChevronUp className="w-5 h-5" />
                        </button>
                        <button onClick={() => handleReorderPlayer(idx, 'down')} disabled={idx === players.length - 1} className="p-1 text-slate-400 hover:text-white disabled:opacity-30">
                          <ChevronDown className="w-5 h-5" />
                        </button>
                        {!p.isHost && (
                          <button onClick={() => handleRemovePlayer(p.id)} className="p-1 ml-2 text-slate-500 hover:text-red-400">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {isHost ? (
              <button
                onClick={handleStartGame}
                disabled={players.length < 2}
                className="w-full py-3.5 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold rounded-xl flex items-center justify-center gap-2"
              >
                <Play className="w-5 h-5" /> Start Game
              </button>
            ) : (
              <div className="p-4 bg-slate-800/50 rounded-xl text-center text-sm text-slate-400 animate-pulse">
                Waiting for host to start the game...
              </div>
            )}
          </div>
        )}

        {gameData.status === 'finished' && (
          <div className="bg-slate-900 border border-amber-500/40 rounded-2xl p-8 text-center max-w-2xl mx-auto w-full shadow-2xl mt-8">
            <Trophy className="w-20 h-20 text-amber-400 mx-auto mb-4" />
            <h2 className="text-3xl font-bold text-amber-300 mb-2">Game Over!</h2>
            <p className="text-slate-300 text-lg mb-8">
              Winner: <strong className="text-white">{leaderboard[0]?.name}</strong> with {latestScores[leaderboard[0]?.id] || 0} pts
            </p>
            
            <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 text-left mb-8">
              <h3 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wider">Final Standings</h3>
              <div className="space-y-3">
                {leaderboard.map((p, idx) => (
                  <div key={p.id} className="flex justify-between items-center bg-slate-900 p-3 rounded-lg">
                    <span className="text-slate-200 font-medium">
                      {idx === 0 && "🥇 "}
                      {idx === 1 && "🥈 "}
                      {idx === 2 && "🥉 "}
                      {idx + 1}. {p.name}
                    </span>
                    <span className="text-amber-400 font-mono font-bold text-lg">
                      {latestScores[p.id] || 0}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {isHost && (
              <button
                onClick={handleResetGame}
                className="py-3 px-8 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl w-full sm:w-auto"
              >
                Return to Lobby
              </button>
            )}
          </div>
        )}

        {(gameData.status === 'bidding' || gameData.status === 'playing') && (
          <div className="space-y-4 pb-12">
            
            {/* Status Header */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center font-black text-xl shadow-lg">
                  R{gameData.currentRound}
                </div>
                <div>
                  <h3 className="font-bold text-slate-100 text-lg">
                    {gameData.currentRound} Cards Dealt
                  </h3>
                  <p className="text-sm text-slate-400">
                    Dealer: <span className="text-amber-400">{currentDealer?.name}</span>
                  </p>
                </div>
              </div>

              <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 w-full sm:w-auto text-sm font-medium">
                <button
                  onClick={() => setActiveTab('input')}
                  className={`flex-1 sm:px-6 py-2 rounded-lg transition-all ${activeTab === 'input' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}
                >
                  {gameData.status === 'bidding' ? 'Enter Bids' : 'Enter Tricks'}
                </button>
                <button
                  onClick={() => setActiveTab('history')}
                  className={`flex-1 sm:px-6 py-2 rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === 'history' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}
                >
                  <History className="w-4 h-4"/> History
                </button>
              </div>
            </div>

            {/* Input View */}
            {activeTab === 'input' && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl relative overflow-hidden flex flex-col">
                
                <div className="p-5 flex-1">
                  {/* --- Bidding Phase --- */}
                  {gameData.status === 'bidding' && (
                    <div className="space-y-5">
                      <div className="border-b border-slate-800 pb-3">
                        <h3 className="font-bold text-amber-400 text-lg">Place Bids</h3>
                        <p className="text-xs text-slate-400">Select a number below to bid.</p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {players.map((p) => {
                          const currentBid = gameData.bids ? gameData.bids[p.id] : undefined;
                          const canEdit = isHost || assignedPlayerId === p.id;
                          const score = latestScores[p.id] || 0;

                          return (
                            <div key={p.id} className="p-4 rounded-xl bg-slate-950 border border-slate-800">
                              <div className="flex justify-between items-center mb-4">
                                <span className="font-bold text-slate-100">{p.name}</span>
                                <span className="text-xs font-mono font-bold text-amber-300 bg-slate-900 px-3 py-1 rounded-full border border-slate-700">
                                  Total: {score}
                                </span>
                              </div>

                              {canEdit ? (
                                <div className="flex flex-wrap gap-2">
                                  {Array.from({ length: gameData.currentRound + 1 }, (_, i) => i).map((num) => {
                                    const isSelected = currentBid === num;
                                    return (
                                      <button
                                        key={num}
                                        onClick={() => handleBidSubmit(p.id, num)}
                                        className={`w-12 h-12 rounded-xl font-mono font-bold text-lg transition-all ${
                                          isSelected
                                            ? 'bg-amber-500 text-slate-950 scale-105 shadow-lg'
                                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                        }`}
                                      >
                                        {num}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="text-sm text-slate-500 py-2 flex items-center gap-2">
                                  {currentBid !== undefined ? (
                                    <><CheckCircle2 className="w-4 h-4 text-green-400"/> Bid placed: {currentBid}</>
                                  ) : (
                                    'Waiting to bid...'
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {isHost && (
                        <div className="pt-2 pb-16">
                          <button
                            onClick={handleEndBidding}
                            disabled={!allBidsIn}
                            className={`w-full py-4 font-bold rounded-xl flex items-center justify-center gap-2 transition-all ${
                              allBidsIn ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20' : 'bg-slate-800 text-slate-500'
                            }`}
                          >
                            <Play className="w-5 h-5" /> End Bidding & Start Round
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* --- Tricks Entry Phase --- */}
                  {gameData.status === 'playing' && (
                    <div className="space-y-5">
                      <div className="border-b border-slate-800 pb-3">
                        <h3 className="font-bold text-indigo-400 text-lg">Record Tricks</h3>
                        <p className="text-xs text-slate-400">Select how many tricks each player won.</p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {players.map((p) => {
                          const bid = gameData.bids ? (gameData.bids[p.id] ?? 0) : 0;
                          const trick = currentTricks[p.id];
                          const canEdit = isHost || assignedPlayerId === p.id;
                          const score = latestScores[p.id] || 0;

                          return (
                            <div key={p.id} className="p-4 rounded-xl bg-slate-950 border border-slate-800">
                              <div className="flex justify-between items-center mb-4">
                                <span className="font-bold text-slate-100">{p.name}</span>
                                <div className="flex gap-2">
                                  <span className="text-xs font-mono font-bold text-amber-300 bg-slate-900 px-3 py-1 rounded-full border border-slate-700">
                                    Total: {score}
                                  </span>
                                  <span className="text-xs font-mono font-bold text-slate-300 bg-indigo-900/50 px-3 py-1 rounded-full border border-indigo-500/30">
                                    Bid: {bid}
                                  </span>
                                </div>
                              </div>

                              {canEdit ? (
                                <div className="flex flex-wrap gap-2">
                                  {Array.from({ length: gameData.currentRound + 1 }, (_, i) => i).map((num) => {
                                    const isSelected = trick === num;
                                    return (
                                      <button
                                        key={num}
                                        onClick={() => setCurrentTricks({ ...currentTricks, [p.id]: num })}
                                        className={`w-12 h-12 rounded-xl font-mono font-bold text-lg transition-all ${
                                          isSelected
                                            ? 'bg-indigo-500 text-white scale-105 shadow-lg'
                                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                        }`}
                                      >
                                        {num}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="text-sm text-slate-500 py-2 flex items-center gap-2">
                                  {trick !== undefined ? (
                                    <><CheckCircle2 className="w-4 h-4 text-indigo-400"/> Tricks won: {trick}</>
                                  ) : (
                                    'Waiting for tricks...'
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {isHost && (
                        <div className="pt-2 pb-16">
                          <button
                            onClick={handleTricksSubmit}
                            disabled={!isValidTricksSum}
                            className={`w-full py-4 font-bold rounded-xl flex items-center justify-center gap-2 transition-all ${
                              isValidTricksSum ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20' : 'bg-slate-800 text-slate-500'
                            }`}
                          >
                            <ShieldCheck className="w-5 h-5" /> Calculate Scores & Next Round
                          </button>
                          {!isValidTricksSum && (
                            <p className="text-center text-xs text-red-400 mt-2">
                              Total tricks must exactly equal {gameData.currentRound} to continue.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Sticky Footer for Totals */}
                <div className="sticky bottom-0 bg-slate-900 border-t border-slate-700/80 p-4 z-10 shadow-[0_-15px_25px_-5px_rgba(0,0,0,0.4)] flex justify-between items-center backdrop-blur-md bg-opacity-95">
                  <div className="flex items-center gap-2 text-slate-300 font-semibold text-sm">
                    <Sigma className="w-5 h-5 text-indigo-400"/>
                    {gameData.status === 'bidding' ? 'Total Bids' : 'Total Won'}
                  </div>
                  <div className={`font-mono font-bold text-xl flex items-baseline gap-1 ${
                    gameData.status === 'playing' 
                      ? (isValidTricksSum ? 'text-emerald-400' : 'text-red-400')
                      : 'text-amber-400'
                  }`}>
                    <span>{gameData.status === 'bidding' ? totalBidsSum : totalTricksSum}</span>
                    <span className="text-sm text-slate-500 font-medium">/ {gameData.currentRound} Max</span>
                  </div>
                </div>

              </div>
            )}

            {activeTab === 'history' && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse min-w-[500px]">
                  <thead>
                    <tr className="border-b border-slate-700 text-slate-400">
                      <th className="py-3 px-3 w-16">Rd</th>
                      {players.map((p) => (
                        <th key={p.id} className="py-3 px-3 text-center text-slate-200">
                          {p.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {roundsHistory.length === 0 ? (
                      <tr>
                        <td colSpan={players.length + 1} className="py-8 text-center text-slate-500">
                          No completed rounds yet.
                        </td>
                      </tr>
                    ) : (
                      roundsHistory.map((rh, idx) => (
                        <tr key={idx} className="hover:bg-slate-800/50">
                          <td className="py-3 px-3 font-mono text-slate-400">R{rh.roundNum}</td>
                          {players.map((p) => {
                            const bid = rh.bids[p.id] ?? 0;
                            const trick = rh.tricks[p.id] ?? 0;
                            const score = rh.scores[p.id] ?? 0;
                            const total = rh.cumulative[p.id] ?? 0;
                            return (
                              <td key={p.id} className="py-3 px-3 text-center">
                                <div className="text-xs text-slate-400 mb-1">
                                  B:{bid} <span className="mx-1">|</span> T:{trick}
                                </div>
                                <div className={`font-mono font-bold mb-1 ${bid === trick ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {score > 0 ? `+${score}` : score}
                                </div>
                                <div className="text-xs text-amber-300 font-mono">
                                  {total}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

          </div>
        )}

        {/* Rules Modal */}
        {showRulesModal && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-6 shadow-2xl shadow-black">
              <h3 className="text-lg font-bold text-amber-300 mb-4 flex items-center gap-2">
                <BookOpen className="w-5 h-5"/> Wizard Rules
              </h3>
              <ul className="text-sm text-slate-300 space-y-3 mb-6">
                <li><strong>Correct Bid:</strong> +20 points + (10 × Tricks Won)</li>
                <li><strong>Incorrect Bid:</strong> -10 points for every trick you are off by.</li>
                <li><strong>Rounds:</strong> Max rounds based on 60 card deck (e.g., 4 players = 15 rounds).</li>
                <li>Total tricks entered must equal the number of cards dealt in that round.</li>
              </ul>
              <button onClick={() => setShowRulesModal(false)} className="w-full py-3 bg-slate-800 hover:bg-slate-700 rounded-xl font-semibold transition-colors">
                Close Rules
              </button>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
