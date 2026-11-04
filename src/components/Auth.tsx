import { useState } from 'react';
import { ArrowRight, Leaf, Waves, Sprout, ShieldCheck } from 'lucide-react';
import { authService } from '../services/auth';
import { configured } from '../services/client';
import { islandService } from '../services/game';
import { AvatarEditor, DEFAULT_AVATAR } from './AvatarEditor';
export function Landing({
  onReady,
  onboarding = false,
  recovery = false,
  onRecovered,
}: {
  onReady: () => void;
  onboarding?: boolean;
  recovery?: boolean;
  onRecovered?: () => void;
}) {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login'),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [username, setUsername] = useState(''),
    [name, setName] = useState(''),
    [avatar, setAvatar] = useState(DEFAULT_AVATAR),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (recovery) {
        await authService.updatePassword(password);
        onRecovered?.();
      } else if (onboarding) {
        await islandService.create(username, name, avatar);
        onReady();
      } else if (mode === 'reset') {
        await authService.reset(email);
        setMessage('Si ce compte existe, un lien de réinitialisation a été envoyé.');
      } else if (mode === 'signup') {
        const d = await authService.signUp(email, password);
        setMessage(
          d.session
            ? 'Compte créé. Préparation de votre île…'
            : 'Consultez votre boîte mail pour confirmer votre inscription.',
        );
      } else await authService.signIn(email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Une erreur est survenue');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="landing">
      <div className="landing-art" aria-hidden="true">
        <div className="sun" />
        <div className="island-illustration">
          <span className="palm p1">🌴</span>
          <span className="palm p2">🌴</span>
          <span className="little-house">🏡</span>
          <span className="flowers">🌿 🌼 🌿</span>
        </div>
        <span className="wave w1">﹏﹏</span>
        <span className="wave w2">﹏﹏﹏</span>
        <div className="art-caption">
          Un petit coin de paradis.
          <br />
          <strong>Une grande aventure à partager.</strong>
        </div>
      </div>
      <section className="landing-content">
        <a href="/" className="brand">
          <span className="brand-mark">
            <Leaf size={24} />
          </span>
          <span>
            island<span className="brand-light">village</span>
            <small>VOTRE ÎLE, VOTRE HISTOIRE</small>
          </span>
        </a>
        <span className="eyebrow">PRENEZ LE TEMPS DE GRANDIR</span>
        <h1>
          {recovery ? (
            'Un nouveau départ.'
          ) : onboarding ? (
            'Votre histoire commence ici.'
          ) : (
            <>
              Votre île.
              <br />À votre rythme.
            </>
          )}
        </h1>
        <p className="muted">
          {onboarding
            ? 'Choisissez votre personnage, nommez votre petit paradis et faites-en un village plein de vie.'
            : 'Plantez un peu de bonheur, bâtissez votre village et retrouvez vos amis sous les palmiers.'}
        </p>
        {!configured ? (
          <div className="setup-card">
            <Waves />
            <h2>Préparons votre île</h2>
            <p>
              Connectez un projet Supabase pour activer les comptes, la sauvegarde et le
              multijoueur.
            </p>
            <ol>
              <li>
                Appliquez la migration du dossier <code>supabase/migrations</code>.
              </li>
              <li>
                Copiez <code>.env.example</code> vers <code>.env.local</code> et renseignez l’URL et
                la clé publique de votre projet.
              </li>
              <li>
                Relancez <code>npm run dev</code>.
              </li>
            </ol>
            <p>Les étapes détaillées sont dans le README. Aucun service n’est simulé.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="auth-form">
            {!onboarding && !recovery && (
              <div className="tabs">
                <button
                  type="button"
                  className={mode === 'login' ? 'active' : ''}
                  onClick={() => setMode('login')}
                >
                  Se connecter
                </button>
                <button
                  type="button"
                  className={mode === 'signup' ? 'active' : ''}
                  onClick={() => setMode('signup')}
                >
                  Créer un compte
                </button>
              </div>
            )}
            {onboarding ? (
              <>
                <label>
                  Pseudonyme
                  <input
                    required
                    pattern="[a-zA-Z0-9_]{3,20}"
                    minLength={3}
                    maxLength={20}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Ex. Camille_42"
                    autoComplete="nickname"
                  />
                  <small>3 à 20 lettres, chiffres ou tirets bas. Unique parmi les joueurs.</small>
                </label>
                <label>
                  Nom de l’île
                  <input
                    required
                    minLength={2}
                    maxLength={30}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex. Île des Alizés"
                  />
                </label>
                <AvatarEditor value={avatar} onChange={setAvatar} />
              </>
            ) : (
              <>
                {!recovery && (
                  <label>
                    Adresse e-mail
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      placeholder="vous@exemple.fr"
                    />
                  </label>
                )}
                {(recovery || mode !== 'reset') && (
                  <label>
                    Mot de passe
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      placeholder="8 caractères minimum"
                    />
                  </label>
                )}
              </>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p className="form-success" role="status">
                {message}
              </p>
            )}
            <button className="primary large" disabled={busy}>
              {busy
                ? 'Un instant…'
                : recovery
                  ? 'Enregistrer le mot de passe'
                  : onboarding
                    ? 'Découvrir mon île'
                    : mode === 'signup'
                      ? 'Créer mon compte'
                      : mode === 'reset'
                        ? 'Recevoir le lien'
                        : 'Retrouver mon île'}
              <ArrowRight size={18} />
            </button>
            {!onboarding && !recovery && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setMode(mode === 'reset' ? 'login' : 'reset');
                  setMessage('');
                  setError('');
                }}
              >
                {mode === 'reset' ? 'Retour à la connexion' : 'Mot de passe oublié ?'}
              </button>
            )}
          </form>
        )}
        <div className="landing-benefits">
          <span>
            <Sprout size={17} /> Cultivez à votre rythme
          </span>
          <span>
            <ShieldCheck size={17} /> Progression sauvegardée
          </span>
        </div>
        <footer>Un monde tout doux, à construire ensemble.</footer>
      </section>
    </main>
  );
}
