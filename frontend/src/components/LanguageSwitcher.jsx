import React, { useState, useRef, useEffect } from 'react';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export default function LanguageSwitcher({ compact = false, align = 'end', dark = false }) {
  const { language, setLanguage, languages, currentLangObj, isRtl } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (code) => {
    setLanguage(code);
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Sélectionner la langue / اختر اللغة / Select Language"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: compact ? '0.35rem 0.6rem' : '0.45rem 0.85rem',
          borderRadius: 'var(--radius-full)',
          backgroundColor: dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(184, 156, 130, 0.12)',
          color: dark ? '#FFFFFF' : 'var(--color-espresso)',
          border: dark ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid var(--color-border)',
          fontSize: compact ? '0.8rem' : '0.85rem',
          fontWeight: '600',
          cursor: 'pointer',
          transition: 'var(--transition-fast)'
        }}
      >
        <Globe size={15} style={{ opacity: 0.85 }} />
        <span style={{ letterSpacing: '0.02em' }}>{currentLangObj.nativeName}</span>
        <ChevronDown size={13} style={{ opacity: 0.7, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }} />
      </button>

      {isOpen && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            [align === 'start' ? (isRtl ? 'right' : 'left') : (isRtl ? 'left' : 'right')]: 0,
            zIndex: 150,
            backgroundColor: '#FFFFFF',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-lg)',
            padding: '0.35rem',
            minWidth: '150px',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.2rem',
            animation: 'fadeIn 0.15s ease-out'
          }}
        >
          {languages.map((lang) => {
            const isSelected = lang.code === language;
            return (
              <button
                key={lang.code}
                role="option"
                aria-selected={isSelected}
                type="button"
                onClick={() => handleSelect(lang.code)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  padding: '0.55rem 0.85rem',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: isSelected ? 'var(--color-primary-subtle)' : 'transparent',
                  color: isSelected ? 'var(--color-primary-dark)' : 'var(--color-espresso)',
                  fontSize: '0.86rem',
                  fontWeight: isSelected ? '700' : '500',
                  textAlign: isRtl ? 'right' : 'left',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease'
                }}
              >
                <span>{lang.nativeName}</span>
                {isSelected && <Check size={14} style={{ color: 'var(--color-primary-dark)' }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
