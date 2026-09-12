import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Trophy, Award, Gift, ArrowRight, ArrowLeft, RotateCw, Check, Copy, HelpCircle, ChevronRight, RefreshCw, X } from 'lucide-react';
import { fetchGames } from '../services/api';
import { useLanguage } from '../context/LanguageContext';

export default function Games({ onNavigateShop }) {
  const { t, language, isRtl } = useLanguage();
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedGame, setSelectedGame] = useState(null);

  useEffect(() => {
    loadGames();
  }, []);

  const loadGames = async () => {
    setLoading(true);
    try {
      const res = await fetchGames();
      if (res.success && Array.isArray(res.games)) {
        setGames(res.games);
      } else {
        setGames([]);
      }
    } catch (err) {
      console.error('Failed to load games:', err);
      setGames([]);
    } finally {
      setLoading(false);
    }
  };

  const getLocalizedText = (field) => {
    if (!field) return '';
    if (typeof field === 'string') return field;
    return field[language] || field.fr || field.en || field.ar || '';
  };

  return (
    <div className="games-page" style={{ minHeight: '80vh', backgroundColor: 'var(--color-bg-base)', padding: '3rem 1rem 5rem' }}>
      <div className="container" style={{ maxWidth: '1140px', margin: '0 auto' }}>
        {/* Header Banner */}
        <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            backgroundColor: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            padding: '0.4rem 1rem',
            borderRadius: '999px',
            fontSize: '0.85rem',
            fontWeight: '700',
            color: 'var(--color-espresso)',
            marginBottom: '1rem',
            boxShadow: 'var(--shadow-sm)'
          }}>
            <Sparkles size={16} color="var(--color-gold)" />
            <span>MERYA DZ EXCLUSIVE</span>
          </div>

          <h1 className="heading-display" style={{
            fontSize: 'clamp(2rem, 4vw, 2.8rem)',
            color: 'var(--color-espresso)',
            marginBottom: '0.8rem',
            fontWeight: '800',
            letterSpacing: isRtl ? '0' : '-0.02em'
          }}>
            {t('games.title')}
          </h1>

          <p style={{
            maxWidth: '620px',
            margin: '0 auto',
            fontSize: '1.05rem',
            color: '#666',
            lineHeight: 1.6
          }}>
            {t('games.subtitle')}
          </p>
        </div>

        {/* Content Area */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '5rem 0' }}>
            <RotateCw size={36} className="animate-spin" style={{ margin: '0 auto', color: 'var(--color-espresso)' }} />
            <p style={{ marginTop: '1rem', color: '#888', fontWeight: '500' }}>{t('common.loading')}</p>
          </div>
        ) : games.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '4rem 2rem',
            backgroundColor: 'var(--color-surface)',
            borderRadius: 'var(--radius-xl)',
            border: '1px solid var(--color-border)',
            maxWidth: '560px',
            margin: '0 auto',
            boxShadow: 'var(--shadow-sm)'
          }}>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: 'var(--color-bg-card)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1.5rem'
            }}>
              <Gift size={32} color="var(--color-espresso)" />
            </div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '0.5rem', color: 'var(--color-espresso)' }}>
              {t('games.noGames')}
            </h3>
            <button
              onClick={() => onNavigateShop && onNavigateShop()}
              className="btn btn-primary"
              style={{ marginTop: '1.5rem', padding: '0.75rem 1.8rem' }}
            >
              <span>{t('home.heroCta')}</span>
              {isRtl ? <ArrowLeft size={16} /> : <ArrowRight size={16} />}
            </button>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '2rem'
          }}>
            {games.map((game) => {
              const gameTitle = getLocalizedText(game.title);
              const gameDesc = getLocalizedText(game.description);
              const discountPercent = game.reward?.discountPercent || 10;
              const discountCode = game.reward?.discountCode || 'MERYAVIP';
              const type = game.type || game.gameType || 'wheel';

              return (
                <div
                  key={game._id}
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    borderRadius: 'var(--radius-xl)',
                    border: '1px solid var(--color-border)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: 'var(--shadow-md)',
                    transition: 'transform 0.25s ease, box-shadow 0.25s ease'
                  }}
                  className="game-card-hover"
                >
                  {/* Card Cover */}
                  <div style={{
                    position: 'relative',
                    aspectRatio: '16 / 9',
                    backgroundColor: 'var(--color-bg-card)',
                    overflow: 'hidden'
                  }}>
                    {game.coverImage ? (
                      <img
                        src={game.coverImage}
                        alt={gameTitle}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: '100%',
                        background: 'linear-gradient(135deg, #1C1917 0%, #382A24 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--color-gold)'
                      }}>
                        {type === 'wheel' && <RotateCw size={54} strokeWidth={1.5} />}
                        {type === 'quiz' && <HelpCircle size={54} strokeWidth={1.5} />}
                        {type === 'scratch' && <Gift size={54} strokeWidth={1.5} />}
                        {type === 'style_matcher' && <Sparkles size={54} strokeWidth={1.5} />}
                      </div>
                    )}

                    <div style={{
                      position: 'absolute',
                      top: '1rem',
                      right: isRtl ? 'auto' : '1rem',
                      left: isRtl ? '1rem' : 'auto',
                      backgroundColor: 'rgba(255, 255, 255, 0.92)',
                      backdropFilter: 'blur(4px)',
                      padding: '0.35rem 0.8rem',
                      borderRadius: '999px',
                      fontSize: '0.78rem',
                      fontWeight: '800',
                      color: 'var(--color-espresso)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      boxShadow: 'var(--shadow-sm)'
                    }}>
                      <Award size={13} color="var(--color-gold)" />
                      <span>-{discountPercent}% {t('games.discount')}</span>
                    </div>
                  </div>

                  {/* Card Body */}
                  <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
                    <h3 style={{
                      fontSize: '1.25rem',
                      fontWeight: '800',
                      color: 'var(--color-espresso)',
                      marginBottom: '0.5rem'
                    }}>
                      {gameTitle}
                    </h3>

                    <p style={{
                      fontSize: '0.9rem',
                      color: '#666',
                      lineHeight: 1.5,
                      marginBottom: '1.5rem',
                      flex: 1
                    }}>
                      {gameDesc || t('games.subtitle')}
                    </p>

                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      borderTop: '1px solid var(--color-border)',
                      paddingTop: '1rem'
                    }}>
                      <div style={{ fontSize: '0.78rem', color: '#888' }}>
                        <span>{t('games.discount')}: </span>
                        <strong style={{ color: 'var(--color-espresso)', fontFamily: 'monospace' }}>{discountCode}</strong>
                      </div>

                      <button
                        onClick={() => setSelectedGame(game)}
                        className="btn btn-primary btn-sm"
                        style={{ padding: '0.55rem 1.25rem', borderRadius: '8px' }}
                      >
                        <span>{t('games.playNow')}</span>
                        {isRtl ? <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /> : <ChevronRight size={14} />}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Interactive Modal when game is selected */}
      {selectedGame && (
        <GamePlayModal
          game={selectedGame}
          onClose={() => setSelectedGame(null)}
          onNavigateShop={onNavigateShop}
        />
      )}

      <style>{`
        .game-card-hover:hover {
          transform: translateY(-4px);
          box-shadow: var(--shadow-lg) !important;
        }
      `}</style>
    </div>
  );
}

// -------------------------------------------------------------
// Interactive Game Play Modal
// -------------------------------------------------------------
function GamePlayModal({ game, onClose, onNavigateShop }) {
  const { t, language, isRtl } = useLanguage();
  const [activeTab, setActiveTab] = useState('play'); // 'play' | 'instructions' | 'rules'
  const [won, setWon] = useState(false);
  const [played, setPlayed] = useState(false);
  const [copied, setCopied] = useState(false);

  const gameType = game.type || game.gameType || 'wheel';

  const getLocalizedText = (field) => {
    if (!field) return '';
    if (typeof field === 'string') return field;
    return field[language] || field.fr || field.en || field.ar || '';
  };

  const title = getLocalizedText(game.title);
  const instructions = getLocalizedText(game.instructions || game.rules);
  const rules = getLocalizedText(game.rules || game.instructions);
  const winnerMessage = getLocalizedText(game.winnerMessage) || t('games.congratulations');
  const rewardCode = game.reward?.discountCode || 'MERYAVIP';
  const rewardPercent = game.reward?.discountPercent || 10;
  const rewardMin = game.reward?.minOrderAmount || 0;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(rewardCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const handleGameFinished = (success = true) => {
    setPlayed(true);
    setWon(success);
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(18, 15, 13, 0.75)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '1rem'
    }}>
      <div style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-xl)',
        maxWidth: '580px',
        width: '100%',
        maxHeight: '92vh',
        overflowY: 'auto',
        boxShadow: 'var(--shadow-xl)',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Modal Header */}
        <div style={{
          padding: '1.25rem 1.75rem',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: '800', color: 'var(--color-espresso)' }}>
              {title}
            </h2>
            <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.1rem' }}>
              {rewardPercent}% {t('games.discount')} {rewardMin > 0 ? `• ${t('games.minOrder')}: ${rewardMin} DZD` : ''}
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#888',
              padding: '0.4rem',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-bg-card)',
          padding: '0 1.5rem'
        }}>
          <button
            onClick={() => setActiveTab('play')}
            style={{
              padding: '0.75rem 1.25rem',
              fontSize: '0.85rem',
              fontWeight: '700',
              border: 'none',
              borderBottom: activeTab === 'play' ? '2px solid var(--color-espresso)' : '2px solid transparent',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              color: activeTab === 'play' ? 'var(--color-espresso)' : '#777'
            }}
          >
            {t('games.playNow')}
          </button>

          {instructions && (
            <button
              onClick={() => setActiveTab('instructions')}
              style={{
                padding: '0.75rem 1.25rem',
                fontSize: '0.85rem',
                fontWeight: '700',
                border: 'none',
                borderBottom: activeTab === 'instructions' ? '2px solid var(--color-espresso)' : '2px solid transparent',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                color: activeTab === 'instructions' ? 'var(--color-espresso)' : '#777'
              }}
            >
              {t('games.instructions')}
            </button>
          )}

          {rules && (
            <button
              onClick={() => setActiveTab('rules')}
              style={{
                padding: '0.75rem 1.25rem',
                fontSize: '0.85rem',
                fontWeight: '700',
                border: 'none',
                borderBottom: activeTab === 'rules' ? '2px solid var(--color-espresso)' : '2px solid transparent',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                color: activeTab === 'rules' ? 'var(--color-espresso)' : '#777'
              }}
            >
              {t('games.rules')}
            </button>
          )}
        </div>

        {/* Modal Content */}
        <div style={{ padding: '2rem 1.75rem' }}>
          {activeTab === 'instructions' && (
            <div style={{ fontSize: '0.95rem', lineHeight: 1.7, color: '#444', whiteSpace: 'pre-line' }}>
              <h4 style={{ fontWeight: '800', marginBottom: '0.75rem', color: 'var(--color-espresso)' }}>
                {t('games.instructions')}
              </h4>
              {instructions}
            </div>
          )}

          {activeTab === 'rules' && (
            <div style={{ fontSize: '0.95rem', lineHeight: 1.7, color: '#444', whiteSpace: 'pre-line' }}>
              <h4 style={{ fontWeight: '800', marginBottom: '0.75rem', color: 'var(--color-espresso)' }}>
                {t('games.rules')}
              </h4>
              {rules}
            </div>
          )}

          {activeTab === 'play' && (
            <div>
              {!played ? (
                <div>
                  {gameType === 'wheel' && (
                    <WheelGame
                      rewardPercent={rewardPercent}
                      onFinish={() => handleGameFinished(true)}
                    />
                  )}
                  {gameType === 'scratch' && (
                    <ScratchGame
                      rewardPercent={rewardPercent}
                      onFinish={() => handleGameFinished(true)}
                    />
                  )}
                  {(gameType === 'quiz' || gameType === 'style_matcher') && (
                    <QuizGame
                      game={game}
                      onFinish={() => handleGameFinished(true)}
                    />
                  )}
                </div>
              ) : (
                /* Post-Game Victory Screen */
                <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                  <div style={{
                    width: '72px',
                    height: '72px',
                    borderRadius: '50%',
                    backgroundColor: '#FEF3C7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 1.25rem',
                    color: '#B45309'
                  }}>
                    <Trophy size={38} />
                  </div>

                  <h3 style={{ fontSize: '1.4rem', fontWeight: '800', color: 'var(--color-espresso)', marginBottom: '0.5rem' }}>
                    {winnerMessage}
                  </h3>

                  <p style={{ fontSize: '0.95rem', color: '#666', maxWidth: '400px', margin: '0 auto 1.5rem', lineHeight: 1.5 }}>
                    {t('games.useAtCheckout')}
                  </p>

                  {/* Voucher Card */}
                  <div style={{
                    backgroundColor: 'var(--color-bg-card)',
                    border: '2px dashed var(--color-gold)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '1.25rem',
                    maxWidth: '360px',
                    margin: '0 auto 1.5rem',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#777', fontWeight: '700' }}>
                      {t('games.yourReward')}
                    </span>

                    <div style={{
                      fontSize: '1.5rem',
                      fontWeight: '900',
                      letterSpacing: '0.15em',
                      fontFamily: 'monospace',
                      color: 'var(--color-espresso)'
                    }}>
                      {rewardCode}
                    </div>

                    <span style={{ fontSize: '0.85rem', fontWeight: '700', color: '#059669' }}>
                      -{rewardPercent}% {t('games.discount')}
                    </span>

                    <button
                      onClick={handleCopyCode}
                      className="btn btn-secondary btn-sm"
                      style={{ marginTop: '0.5rem', width: '100%', justifyContent: 'center' }}
                    >
                      {copied ? <Check size={14} color="#059669" /> : <Copy size={14} />}
                      <span>{copied ? t('games.codeCopied') : t('games.copyCode')}</span>
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                    <button
                      onClick={() => setPlayed(false)}
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '0.65rem 1.25rem' }}
                    >
                      <RefreshCw size={14} className="rtl-flip" />
                      <span>{t('games.playAgain')}</span>
                    </button>

                    <button
                      onClick={() => {
                        onClose();
                        if (onNavigateShop) onNavigateShop();
                      }}
                      className="btn btn-primary btn-sm"
                      style={{ padding: '0.65rem 1.5rem' }}
                    >
                      <span>{t('home.heroCta')}</span>
                      {isRtl ? <ArrowLeft size={14} /> : <ArrowRight size={14} />}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Interactive Wheel of Fortune Component
// -------------------------------------------------------------
function WheelGame({ rewardPercent, onFinish }) {
  const { t } = useLanguage();
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);

  const segments = [
    { label: `-${rewardPercent}%`, color: '#2B2320', text: '#FFFFFF' },
    { label: 'GIFT', color: '#E8E1D9', text: '#2B2320' },
    { label: `-${rewardPercent}%`, color: '#C5A880', text: '#2B2320' },
    { label: 'VIP', color: '#2B2320', text: '#FFFFFF' },
    { label: `-${rewardPercent}%`, color: '#E8E1D9', text: '#2B2320' },
    { label: 'LUCKY', color: '#C5A880', text: '#2B2320' }
  ];

  const handleSpin = () => {
    if (spinning) return;
    setSpinning(true);

    // Random rotation between 5 and 8 full spins + target segment
    const extraDegrees = 1800 + Math.floor(Math.random() * 360);
    const newRotation = rotation + extraDegrees;
    setRotation(newRotation);

    setTimeout(() => {
      setSpinning(false);
      onFinish();
    }, 4500);
  };

  return (
    <div style={{ textAlign: 'center', padding: '1rem 0' }}>
      <div style={{ position: 'relative', width: '260px', height: '260px', margin: '0 auto 2rem' }}>
        {/* Pointer Pin */}
        <div style={{
          position: 'absolute',
          top: '-14px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '14px solid transparent',
          borderRight: '14px solid transparent',
          borderTop: '24px solid #B45309',
          zIndex: 10,
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))'
        }} />

        {/* Wheel Disc */}
        <div style={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          border: '6px solid var(--color-espresso)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          overflow: 'hidden',
          position: 'relative',
          transition: 'transform 4.5s cubic-bezier(0.15, 0.9, 0.2, 1)',
          transform: `rotate(${rotation}deg)`
        }}>
          {segments.map((seg, i) => {
            const angle = (360 / segments.length) * i;
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  width: '50%',
                  height: '50%',
                  top: '50%',
                  left: '50%',
                  transformOrigin: '0% 0%',
                  transform: `rotate(${angle}deg) skewY(${90 - 360 / segments.length}deg)`,
                  backgroundColor: seg.color
                }}
              />
            );
          })}

          {/* Wheel Labels */}
          {segments.map((seg, i) => {
            const angle = (360 / segments.length) * i + (360 / segments.length) / 2;
            return (
              <div
                key={`label-${i}`}
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  width: '100px',
                  textAlign: 'center',
                  transformOrigin: '0% 0%',
                  transform: `rotate(${angle}deg) translate(40px, -50%)`,
                  fontSize: '0.78rem',
                  fontWeight: '800',
                  color: seg.text,
                  pointerEvents: 'none'
                }}
              >
                {seg.label}
              </div>
            );
          })}

          {/* Center Hub */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            backgroundColor: 'var(--color-espresso)',
            border: '3px solid var(--color-gold)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            zIndex: 5
          }}>
            <Sparkles size={16} color="var(--color-gold)" />
          </div>
        </div>
      </div>

      <button
        onClick={handleSpin}
        disabled={spinning}
        className="btn btn-primary"
        style={{ padding: '0.85rem 2.5rem', fontSize: '1rem', fontWeight: '800', borderRadius: '999px', boxShadow: 'var(--shadow-md)' }}
      >
        {spinning ? <RotateCw size={18} className="animate-spin" /> : <Sparkles size={18} />}
        <span>{spinning ? t('games.spinning') : t('games.spin')}</span>
      </button>
    </div>
  );
}

// -------------------------------------------------------------
// Scratch & Reveal Component
// -------------------------------------------------------------
function ScratchGame({ rewardPercent, onFinish }) {
  const { t } = useLanguage();
  const [revealed, setRevealed] = useState(false);

  const handleReveal = () => {
    setRevealed(true);
    setTimeout(() => {
      onFinish();
    }, 1200);
  };

  return (
    <div style={{ textAlign: 'center', padding: '1rem 0' }}>
      <div
        onClick={handleReveal}
        style={{
          width: '280px',
          height: '180px',
          margin: '0 auto 1.5rem',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          position: 'relative',
          cursor: revealed ? 'default' : 'pointer',
          border: '2px solid var(--color-espresso)',
          boxShadow: 'var(--shadow-md)',
          userSelect: 'none'
        }}
      >
        {/* Prize Layer Underneath */}
        <div style={{
          width: '100%',
          height: '100%',
          backgroundColor: '#FEF3C7',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem'
        }}>
          <Trophy size={36} color="#B45309" />
          <span style={{ fontSize: '1.25rem', fontWeight: '900', color: 'var(--color-espresso)', marginTop: '0.5rem' }}>
            -{rewardPercent}% {t('games.discount')}
          </span>
          <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#B45309' }}>
            {t('games.congratulations')}
          </span>
        </div>

        {/* Scratchable Mask Layer */}
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: '#382A24',
          backgroundImage: 'radial-gradient(#5C453C 15%, transparent 16%)',
          backgroundSize: '16px 16px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#FBF9F5',
          transition: 'opacity 0.7s ease, transform 0.7s ease',
          opacity: revealed ? 0 : 1,
          transform: revealed ? 'scale(1.08)' : 'scale(1)',
          pointerEvents: revealed ? 'none' : 'auto'
        }}>
          <Gift size={36} color="var(--color-gold)" />
          <span style={{ marginTop: '0.5rem', fontSize: '0.95rem', fontWeight: '700', letterSpacing: '0.05em' }}>
            {t('games.scratch')}
          </span>
          <span style={{ fontSize: '0.75rem', color: '#D5C4B4', marginTop: '0.2rem' }}>
            (Click to scratch)
          </span>
        </div>
      </div>

      <button
        onClick={handleReveal}
        disabled={revealed}
        className="btn btn-primary"
        style={{ padding: '0.75rem 2rem', borderRadius: '999px' }}
      >
        <Sparkles size={16} />
        <span>{t('games.reveal')}</span>
      </button>
    </div>
  );
}

// -------------------------------------------------------------
// Fashion Quiz / Style Matcher Component
// -------------------------------------------------------------
function QuizGame({ game, onFinish }) {
  const { t, language, isRtl } = useLanguage();
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);

  const getLocalized = (f) => {
    if (!f) return '';
    if (typeof f === 'string') return f;
    return f[language] || f.fr || f.en || f.ar || '';
  };

  // Default questions if none defined in game schema
  const defaultQuestions = [
    {
      question: {
        fr: 'Quelle est votre matière de prédilection pour une silhouette fluide et raffinée ?',
        ar: 'ما هو قماشك المفضل لإطلالة انسيابية وراقية؟',
        en: 'What is your fabric of choice for a graceful, refined silhouette?'
      },
      options: [
        { text: { fr: 'Soie de Médine premium', ar: 'حرير المدينة الفاخر', en: 'Premium Medina Silk' }, isCorrect: true },
        { text: { fr: 'Lin lavé haute qualité', ar: 'الكتان المغسول الراقي', en: 'Washed Pure Linen' }, isCorrect: true },
        { text: { fr: 'Crêpe fluide royal', ar: 'الكريب الانسيابي الملكي', en: 'Royal Flowing Crepe' }, isCorrect: true }
      ]
    },
    {
      question: {
        fr: 'Quelle palette de couleurs correspond le mieux à votre style élégant ?',
        ar: 'أي لوحة ألوان تعبر أكثر عن أناقتك وذوقك؟',
        en: 'Which color palette best reflects your personal elegance?'
      },
      options: [
        { text: { fr: 'Tons poudrés & Crème doux', ar: 'درجات البودرة والبيج الهادئ', en: 'Powder Tones & Soft Cream' }, isCorrect: true },
        { text: { fr: 'Espresso & Chocolat profond', ar: 'البني الإسبريسو والشكولاطة', en: 'Deep Espresso & Chocolate' }, isCorrect: true },
        { text: { fr: 'Bleu nuit & Vert émeraude', ar: 'الأزرق الليلي والأخضر الزمردي', en: 'Midnight Navy & Emerald' }, isCorrect: true }
      ]
    }
  ];

  const questions = (game.questions && game.questions.length > 0) ? game.questions : defaultQuestions;
  const currentQ = questions[currentIdx];

  const handleSelectOption = (idx) => {
    setSelectedAnswer(idx);
  };

  const handleNext = () => {
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(currentIdx + 1);
      setSelectedAnswer(null);
    } else {
      onFinish();
    }
  };

  return (
    <div style={{ padding: '0.5rem 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--color-espresso)' }}>
          Question {currentIdx + 1} / {questions.length}
        </span>
        <div style={{ display: 'flex', gap: '4px' }}>
          {questions.map((_, i) => (
            <div
              key={i}
              style={{
                width: '24px',
                height: '4px',
                borderRadius: '2px',
                backgroundColor: i <= currentIdx ? 'var(--color-espresso)' : 'var(--color-border)'
              }}
            />
          ))}
        </div>
      </div>

      <h4 style={{
        fontSize: '1.1rem',
        fontWeight: '800',
        color: 'var(--color-espresso)',
        lineHeight: 1.5,
        marginBottom: '1.5rem'
      }}>
        {getLocalized(currentQ.question)}
      </h4>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.75rem' }}>
        {currentQ.options.map((opt, i) => {
          const isSelected = selectedAnswer === i;
          return (
            <button
              key={i}
              type="button"
              onClick={() => handleSelectOption(i)}
              style={{
                padding: '0.9rem 1.25rem',
                borderRadius: 'var(--radius-md)',
                border: isSelected ? '2px solid var(--color-espresso)' : '1px solid var(--color-border)',
                backgroundColor: isSelected ? 'var(--color-bg-card)' : 'var(--color-surface)',
                textAlign: isRtl ? 'right' : 'left',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: isSelected ? '700' : '500',
                color: 'var(--color-espresso)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'var(--transition-fast)'
              }}
            >
              <span>{getLocalized(opt.text)}</span>
              {isSelected && <Check size={16} color="var(--color-espresso)" />}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={handleNext}
          disabled={selectedAnswer === null}
          className="btn btn-primary"
          style={{ padding: '0.65rem 1.6rem', opacity: selectedAnswer === null ? 0.6 : 1 }}
        >
          <span>{currentIdx === questions.length - 1 ? t('games.finishQuiz') : t('games.nextQuestion')}</span>
          {isRtl ? <ArrowLeft size={16} /> : <ArrowRight size={16} />}
        </button>
      </div>
    </div>
  );
}
