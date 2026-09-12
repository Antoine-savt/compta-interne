import { useState } from 'react';

/**
 * Icône "?" avec bulle d'aide contextuelle.
 * Usage : <Tooltip text="Explication claire en langage courant." />
 */
export function Tooltip({ text }) {
    const [open, setOpen] = useState(false);
    return (
        <span className="tooltip-wrap">
            <button
                type="button"
                className="tooltip-trigger"
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
                onClick={() => setOpen((o) => !o)}
                aria-label="Aide"
            >
                ?
            </button>
            {open && <span className="tooltip-bubble">{text}</span>}
        </span>
    );
}

/**
 * Toggle switch oui/non avec label et tooltip optionnel.
 */
export function ToggleSwitch({ id, label, checked, onChange, tooltip }) {
    return (
        <div className="toggle-row">
            <label className="switch">
                <input
                    type="checkbox"
                    id={id}
                    checked={checked}
                    onChange={(e) => onChange(e.target.checked)}
                />
                <span className="switch__track" />
                <span className="switch__thumb" />
            </label>
            <label htmlFor={id} style={{ cursor: 'pointer', userSelect: 'none' }}>
                {label}
            </label>
            {tooltip && <Tooltip text={tooltip} />}
        </div>
    );
}

/**
 * Sélecteur de fréquence unifié.
 * Valeur : { type: 'ponctuel' | 'recurrent', intervalleNombre, intervalleUnite, montantFixe, occurrencesPassees }
 */
export function SelecteurFrequence({ value, onChange, occurrencesPassees = 0 }) {
    const recurrent = value?.type === 'recurrent';
    const montantFixe = value?.montantFixe ?? (occurrencesPassees >= 3);

    const update = (patch) => onChange({ ...value, ...patch });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Ponctuel / Récurrent */}
            <div style={{ display: 'flex', gap: 8 }}>
                {['ponctuel', 'recurrent'].map((t) => (
                    <button
                        key={t}
                        type="button"
                        className={`btn btn--sm ${value?.type === t ? 'btn--primary' : 'btn--ghost'}`}
                        onClick={() => update({ type: t })}
                    >
                        {t === 'ponctuel' ? 'Ponctuel' : 'Récurrent'}
                    </button>
                ))}
            </div>

            {recurrent && (
                <>
                    {/* Intervalle */}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Tous les</span>
                        <input
                            type="number"
                            min="1"
                            className="form-input"
                            style={{ width: 70 }}
                            value={value?.intervalleNombre ?? 1}
                            onChange={(e) => update({ intervalleNombre: parseInt(e.target.value) || 1 })}
                        />
                        <select
                            className="form-select"
                            style={{ width: 120 }}
                            value={value?.intervalleUnite ?? 'mois'}
                            onChange={(e) => update({ intervalleUnite: e.target.value })}
                        >
                            <option value="jour">jour(s)</option>
                            <option value="semaine">semaine(s)</option>
                            <option value="mois">mois</option>
                            <option value="annee">année(s)</option>
                        </select>
                    </div>

                    {/* Montant fixe / variable */}
                    <ToggleSwitch
                        id="montant-fixe"
                        label={montantFixe ? 'Montant fixe à chaque échéance' : 'Montant variable (à confirmer)'}
                        checked={montantFixe}
                        onChange={(v) => update({ montantFixe: v })}
                        tooltip={
                            montantFixe
                                ? "L'application génère l'écriture automatiquement à chaque échéance, sans votre intervention."
                                : `Le montant peut changer d'une fois à l'autre (ex. renouvellement de nom de domaine). ${occurrencesPassees < 3
                                    ? `Pré-coché "variable" car seulement ${occurrencesPassees} occurrence(s) passée(s)  basculez sur "fixe" une fois le montant stabilisé.`
                                    : ''
                                }`
                        }
                    />
                </>
            )}
        </div>
    );
}
