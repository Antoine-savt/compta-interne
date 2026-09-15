import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { formatDate, toISODate } from '../../services/helpers';

/**
 * Composant DateInput universel au format français (JJ/MM/AAAA).
 * 
 * - Affichage et saisie en JJ/MM/AAAA
 * - Valeur d'entrée et de sortie en YYYY-MM-DD (standard ISO / Firebase)
 * - Compatible avec l'API native d'un input : value, onChange({ target: { value } }), required, disabled, style...
 * - Bouton calendrier intégré permettant d'ouvrir le sélecteur natif
 * - Formatage automatique des séparateurs '/' lors de la frappe
 */
export const DateInput = forwardRef(function DateInput(
    {
        value = '',
        onChange,
        className = 'form-input',
        style = {},
        placeholder = 'JJ/MM/AAAA',
        disabled = false,
        required = false,
        id,
        name,
        min,
        max,
        autoFocus = false,
        onBlur,
        onKeyDown,
        title,
        ...rest
    },
    ref
) {
    const textInputRef = useRef(null);
    const nativePickerRef = useRef(null);

    useImperativeHandle(ref, () => textInputRef.current);

    // Convertit YYYY-MM-DD en JJ/MM/AAAA pour l'affichage
    const formatToDisplay = (iso) => {
        if (!iso) return '';
        const m = String(iso).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[3]}/${m[2]}/${m[1]}`;
        // Si c'est déjà JJ/MM/AAAA
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(iso.trim())) return iso.trim();
        return formatDate(iso);
    };

    // État local pour la valeur textuelle affichée (JJ/MM/AAAA)
    const [displayVal, setDisplayVal] = useState(() => formatToDisplay(value));

    // Synchronisation lorsque la prop `value` change depuis l'extérieur
    useEffect(() => {
        setDisplayVal(formatToDisplay(value));
    }, [value]);

    // Validation et conversion de JJ/MM/AAAA vers YYYY-MM-DD
    const parseToIso = (text) => {
        if (!text) return '';
        const cleaned = text.trim();
        const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) {
            const day = Number(m[1]);
            const month = Number(m[2]);
            const year = Number(m[3]);
            if (year < 1900 || year > 2100) return null;
            if (month < 1 || month > 12) return null;
            if (day < 1 || day > 31) return null;

            // Vérification jours dans le mois
            const testDate = new Date(year, month - 1, day);
            if (
                testDate.getFullYear() === year &&
                testDate.getMonth() === month - 1 &&
                testDate.getDate() === day
            ) {
                const sYear = String(year);
                const sMonth = String(month).padStart(2, '0');
                const sDay = String(day).padStart(2, '0');
                return `${sYear}-${sMonth}-${sDay}`;
            }
        }
        return null;
    };

    // Déclenche l'événement onChange parent compatible <input>
    const emitChange = (isoVal) => {
        if (onChange) {
            onChange({
                target: {
                    value: isoVal,
                    name: name || id || '',
                    id: id || '',
                },
            });
        }
    };

    // Gestion de la saisie manuelle au clavier
    const handleTextChange = (e) => {
        const raw = e.target.value;
        // Autoriser uniquement chiffres et barres obliques
        const filtered = raw.replace(/[^\d/]/g, '');

        // Formatage automatique du masque JJ/MM/AAAA lors de la saisie numérique
        let formatted = filtered;
        // Si l'utilisateur tape des chiffres sans barres
        const digitsOnly = filtered.replace(/\//g, '');
        if (digitsOnly.length > 0 && !raw.endsWith('/')) {
            if (digitsOnly.length <= 2) {
                formatted = digitsOnly;
            } else if (digitsOnly.length <= 4) {
                formatted = `${digitsOnly.slice(0, 2)}/${digitsOnly.slice(2)}`;
            } else {
                formatted = `${digitsOnly.slice(0, 2)}/${digitsOnly.slice(2, 4)}/${digitsOnly.slice(4, 8)}`;
            }
        }

        setDisplayVal(formatted);

        // Si le champ est entièrement vidé
        if (!formatted) {
            emitChange('');
            return;
        }

        // Si une date complète et valide est saisie
        if (formatted.length === 10) {
            const iso = parseToIso(formatted);
            if (iso) {
                emitChange(iso);
            }
        }
    };

    const handleBlur = (e) => {
        // À la perte de focus, si la saisie est incomplète ou invalide
        if (displayVal && displayVal.length < 10) {
            // Rétablir la dernière valeur valide
            setDisplayVal(formatToDisplay(value));
        } else if (displayVal.length === 10) {
            const iso = parseToIso(displayVal);
            if (iso) {
                emitChange(iso);
                setDisplayVal(formatToDisplay(iso));
            } else {
                setDisplayVal(formatToDisplay(value));
            }
        }
        if (onBlur) onBlur(e);
    };

    // Sélection depuis le calendrier natif
    const handleNativeChange = (e) => {
        const isoVal = e.target.value;
        if (isoVal) {
            setDisplayVal(formatToDisplay(isoVal));
            emitChange(isoVal);
        }
    };

    const openCalendar = () => {
        if (disabled) return;
        try {
            if (nativePickerRef.current?.showPicker) {
                nativePickerRef.current.showPicker();
            } else {
                nativePickerRef.current?.click();
            }
        } catch {
            nativePickerRef.current?.click();
        }
    };

    // Détermination de la largeur : respecter style.width s'il est spécifié
    const containerStyle = {
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        verticalAlign: 'middle',
        width: style?.width || (style?.maxWidth ? style.maxWidth : '100%'),
        maxWidth: style?.maxWidth,
        minWidth: style?.minWidth,
        flex: style?.flex,
    };

    // Style de l'input texte
    const inputStyle = {
        ...style,
        width: '100%',
        paddingRight: '34px', // Place pour l'icône calendrier
        boxSizing: 'border-box',
    };

    return (
        <div style={containerStyle} className="date-input-container">
            <input
                ref={textInputRef}
                type="text"
                inputMode="numeric"
                className={className}
                style={inputStyle}
                placeholder={placeholder}
                value={displayVal}
                onChange={handleTextChange}
                onBlur={handleBlur}
                onKeyDown={onKeyDown}
                disabled={disabled}
                required={required}
                id={id}
                name={name}
                autoFocus={autoFocus}
                title={title || 'Format : JJ/MM/AAAA'}
                autoComplete="off"
                {...rest}
            />

            {/* Bouton icône calendrier interactif */}
            <div
                style={{
                    position: 'absolute',
                    right: 6,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 26,
                    height: 26,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: disabled ? 'default' : 'pointer',
                    borderRadius: 4,
                    color: 'var(--text-muted)',
                    zIndex: 1,
                    overflow: 'hidden',
                }}
                onClick={openCalendar}
                title="Ouvrir le calendrier"
            >
                <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ pointerEvents: 'none' }}
                >
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                </svg>

                {/* Input natif invisible superposé pour ouvrir directement le calendrier au clic */}
                <input
                    ref={nativePickerRef}
                    type="date"
                    tabIndex={-1}
                    value={value || ''}
                    min={min}
                    max={max}
                    onChange={handleNativeChange}
                    disabled={disabled}
                    style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        opacity: 0,
                        cursor: disabled ? 'default' : 'pointer',
                        zIndex: 2,
                    }}
                />
            </div>
        </div>
    );
});

export default DateInput;
