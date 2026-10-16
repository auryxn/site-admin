import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const API = '';

// Static mode: used for the GitHub Pages build (no backend available).
// Enabled at build time via VITE_STATIC=1. In dev / local `npm start` this is
// false, so the live API (/api/site) and the admin panel keep working.
const STATIC = import.meta.env.VITE_STATIC === '1';
// Resolve asset + data URLs against the Vite base path (/site-admin/ on Pages).
const BASE = import.meta.env.BASE_URL || '/';
function baseUrl(p) {
  const s = String(p || '');
  if (/^(https?:)?\/\//.test(s) || s.startsWith('data:') || s.startsWith('#')) return s;
  return BASE.replace(/\/$/, '') + (s.startsWith('/') ? s : '/' + s);
}

let staticCache = null;
async function fetchStaticSite(lang) {
  if (!staticCache) {
    const res = await fetch(`${BASE}site-data.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    staticCache = await res.json();
  }
  const data = staticCache[lang] || staticCache.ru;
  if (!data) throw new Error('no static data');
  return data;
}

const LANGS = ['ru', 'lt', 'en'];
const LANG_LABELS = { ru: 'RU', lt: 'LT', en: 'EN' };
const LANG_KEY = 'site_lang';

const DEFAULT_UI = {
  'nav.projects': 'Проекты',
  'nav.stack': 'Стек',
  'nav.experience': 'Опыт',
  'nav.contacts': 'Контакты',
  'nav.new': 'NEW!',
  'section.projects': 'ПРОЕКТЫ',
  'section.stack': 'СТЕК',
  'section.experience': 'ОПЫТ',
  'section.contacts': 'КОНТАКТЫ',
  'intro.prefix': 'Я',
  'intro.dev': 'Пишу сайты и сервисы',
  'intro.status': 'Статус:',
  visitors: 'Посетителей:',
  'projects.repo_link': '[открыть репозиторий →]',
  'projects.stack_label': 'Стек:',
  'exp.when': 'Когда',
  'exp.where': 'Где',
  'exp.what': 'Что делал',
  'bsod.button': 'НЕ_НАЖИМАТЬ.exe',
  'bsod.tag': 'Ошибка',
  'bsod.line1': 'Критическая ошибка: слишком честный сайт.',
  'bsod.line2': 'Нажмите любую клавишу или коснитесь экрана_',
  'popup.yes': 'Да, конечно',
  'popup.no': 'Закрыть',
  'popup.no_final': 'Ладно, закрывай',
  'popup.mail_subject': 'Хочу нанять',
  follower: '← ты тут',
  'intro.fallback_bio': 'Этот сайт намеренно выглядит так.',
  loading: 'ЗАГРУЗКА… ПОЖАЛУЙСТА, ПОДОЖДИТЕ / Netscape Navigator 4.0',
  'error.load': 'ОШИБКА ЗАГРУЗКИ ДАННЫХ',
  'error.hint': 'Не удалось получить данные с сервера. Обновите страницу.',
  'lang.label': 'Язык:',
};

function initialLang() {
  try {
    const params = new URLSearchParams(window.location.search);
    const q = (params.get('lang') || '').toLowerCase();
    if (LANGS.includes(q)) return q;
    const stored = (localStorage.getItem(LANG_KEY) || '').toLowerCase();
    if (LANGS.includes(stored)) return stored;
  } catch {
    /* ignore */
  }
  return 'ru';
}

async function fetchSite(lang) {
  if (STATIC) return fetchStaticSite(lang);
  const res = await fetch(`${API}/api/site?lang=${encodeURIComponent(lang)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function pad6(n) {
  return String(n).padStart(6, '0');
}

export default function Site() {
  const [lang, setLang] = useState(initialLang);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  // Keep localStorage + URL (?lang=) in sync with the selected language.
  useEffect(() => {
    try {
      localStorage.setItem(LANG_KEY, lang);
      const url = new URL(window.location.href);
      if (lang === 'ru') url.searchParams.delete('lang');
      else url.searchParams.set('lang', lang);
      window.history.replaceState(null, '', url.toString());
    } catch {
      /* ignore */
    }
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);

  // Always fetch fresh data on load / language change. getFreshData() silently
  // refreshes the already-rendered state without touching the language or the
  // scroll position (used by the live-refresh below).
  useEffect(() => {
    let alive = true;
    setError('');
    fetchSite(lang)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [lang]);

  // Live refresh: re-fetch current-language data every ~8s, whenever the tab
  // regains focus, and when the admin panel signals a save. State is merged
  // silently so language + scroll stay put.
  useEffect(() => {
    if (STATIC) return undefined; // no polling without a backend
    if (!data) return undefined; // only poll once we have something rendered
    let alive = true;
    const refresh = () => {
      if (inFlight.current) return;
      inFlight.current = true;
      fetchSite(lang)
        .then((d) => {
          if (alive) setData(d);
        })
        .catch(() => {
          /* keep showing the last good data on transient errors */
        })
        .finally(() => {
          inFlight.current = false;
        });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const onStorage = (e) => {
      if (e && e.key === 'site_content_updated') refresh();
    };
    const timer = setInterval(refresh, 8000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, [lang, data]);

  const ui = useMemo(() => ({ ...DEFAULT_UI, ...((data && data.ui) || {}) }), [data]);
  const t = useCallback((key) => ui[key] || DEFAULT_UI[key] || key, [ui]);

  if (error) {
    return (
      <div className="w" style={{ paddingTop: 24 }}>
        <div className="bar">
          {t('error.load')} — {error}
        </div>
        <p>{t('error.hint')}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="bar" aria-hidden="true">
        {DEFAULT_UI.loading}
      </div>
    );
  }

  const { profile = {}, projects = [], stack = [], experience = [], links = [], settings = {} } = data;
  const startCounter = Number(settings.counter_start) || 137;

  return (
    <>
      <div className="bar" aria-hidden="true">
        {settings.title_bar || 'C:\\Users\\alex\\Desktop\\portfolio\\index_final_v3_REAL_FINAL.html — Netscape Navigator 4.0'}
      </div>
      <h1 aria-label={profile.name}>
        {splitName(profile.name).map((part, i) => (
          <span key={i}>{part}</span>
        ))}
      </h1>
      <Marquee text={settings.marquee_text} />
      <div className="w">
        <Nav t={t} lang={lang} setLang={setLang} />
        <p>
          {t('intro.prefix')} <b>{profile.title}</b>. {t('intro.dev')}{' '}
          <span className="hlt">{profile.years}</span>.{' '}
          {profile.bio_text ? stripTags(profile.bio_text) : t('intro.fallback_bio')}{' '}
          {t('intro.status')} <span className="spin">{profile.status}</span>
        </p>
        <p>
          {t('visitors')} <Counter start={startCounter} />{' '}
          <span className="st">{settings.badge || 'ВЕБ 1.0'}</span>
        </p>
        <hr />
        <h2 id="p">{t('section.projects')}</h2>
        <p>{settings.projects_note || 'Нажми на строку. Или не нажимай. Мне всё равно (нет).'}</p>
        <div id="pj">
          {projects.map((pr) => (
            <details key={pr.id ?? pr.title}>
              <summary>{pr.title}.exe</summary>
              <div className="c">
                <p>{pr.description}</p>
                {pr.image_url ? (
                  <img
                    className="pj-img"
                    src={baseUrl(pr.image_url)}
                    alt={pr.title}
                    loading="lazy"
                  />
                ) : null}
                {pr.repo_url ? (
                  <p className="pj-repo">
                    <a href={pr.repo_url} target="_blank" rel="noopener noreferrer">
                      {t('projects.repo_link')}
                    </a>
                  </p>
                ) : null}
                <ul>
                  {(pr.bullets || []).map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
                <p>
                  <b>{t('projects.stack_label')}</b> {pr.stack}
                </p>
              </div>
            </details>
          ))}
        </div>
        <hr />
        <h2 id="s">{t('section.stack')}</h2>
        <ul className="sk">
          {stack.map((s) => (
            <li key={s.id ?? s.name}>{s.name}</li>
          ))}
        </ul>
        <hr />
        <h2 id="e">{t('section.experience')}</h2>
        <table>
          <tbody>
            <tr>
              <th>{t('exp.when')}</th>
              <th>{t('exp.where')}</th>
              <th>{t('exp.what')}</th>
            </tr>
            {experience.map((e) => (
              <tr key={e.id ?? e.company}>
                <td>{e.period}</td>
                <td>{e.company}</td>
                <td>{e.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <hr />
        <h2 id="c">{t('section.contacts')}</h2>
        <p>{settings.contacts_note || 'Пишите, отвечаю быстрее, чем грузится этот сайт:'}</p>
        <a className="big" href={`mailto:${profile.email}`}>
          {profile.email}
        </a>
        <p>
          {links.map((l, i) => (
            <React.Fragment key={l.id ?? l.label}>
              {i > 0 ? ' · ' : ''}
              <a
                href={l.url || '#'}
                target={l.url && l.url !== '#' ? '_blank' : undefined}
                rel="noreferrer"
              >
                {l.label}
              </a>
            </React.Fragment>
          ))}
        </p>
        <hr />
        <p style={{ fontSize: 14 }}>
          {settings.footer_text || '© 2026 Алексей Иода. Лучше всего просматривается в Netscape Navigator.'}
        </p>
        <p style={{ color: '#888', fontSize: 13 }}>
          [ Web 1.0 counter · {t('lang.label')} {LANG_LABELS[lang]} ]
        </p>
      </div>
      <Popup email={profile.email} title={settings.popup_title} text={settings.popup_text} t={t} />
      <Follower t={t} />
      <BsodTrigger label={t('bsod.button')} t={t} />
    </>
  );
}

function splitName(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts : ['Алексей', 'Иода'];
}

function stripTags(html = '') {
  return String(html).replace(/<[^>]*>/g, '');
}

function Nav({ t, lang, setLang }) {
  return (
    <p className="nav">
      <span className="bl">{t('nav.new')}</span> <a href="#p">{t('nav.projects')}</a> |{' '}
      <a href="#s">{t('nav.stack')}</a> | <a href="#e">{t('nav.experience')}</a> |{' '}
      <a href="#c">{t('nav.contacts')}</a>{' '}
      {lang && setLang ? (
        <>
          {' '}
          | <LangSwitch lang={lang} setLang={setLang} t={t} />
        </>
      ) : null}
    </p>
  );
}

// Web 1.0 language switcher: a row of links "RU | LT | EN", active language
// rendered as a non-navigable underlined bold marker.
function LangSwitch({ lang, setLang, t }) {
  return (
    <span className="lang" title={t('lang.label')}>
      {LANGS.map((l, i) => (
        <React.Fragment key={l}>
          {i > 0 ? ' | ' : ''}
          {l === lang ? (
            <span className="on">{LANG_LABELS[l]}</span>
          ) : (
            <a
              href={`?lang=${l}`}
              onClick={(e) => {
                e.preventDefault();
                setLang(l);
              }}
            >
              {LANG_LABELS[l]}
            </a>
          )}
        </React.Fragment>
      ))}
    </span>
  );
}

function Marquee({ text }) {
  const base = text || '★ ВНИМАНИЕ ★ ЭТОТ САЙТ НАМЕРЕННО ВЫГЛЯДИТ ТАК ★ НАНИМАЙТЕ РАЗРАБОТЧИКА ★ ';
  return (
    <div className="mq" aria-hidden="true">
      <div>{base.repeat(8)}</div>
    </div>
  );
}

function Counter({ start }) {
  const [n, setN] = useState(start);
  useEffect(() => {
    setN(start);
    const t = setInterval(() => {
      setN((prev) => prev + (Math.random() < 0.6 ? 1 : 0));
    }, 1500);
    return () => clearInterval(t);
  }, [start]);
  return (
    <span className="cnt" id="cnt">
      {pad6(n)}
    </span>
  );
}

function Follower({ t }) {
  const ref = useRef(null);
  useEffect(() => {
    const onMove = (e) => {
      const f = ref.current;
      if (f) f.style.transform = `translate(${e.clientX + 16}px,${e.clientY + 10}px)`;
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  return (
    <div className="fol" ref={ref}>
      {t('follower')}
    </div>
  );
}

function Popup({ email, title, text, t }) {
  const [open, setOpen] = useState(true);
  const [dodge, setDodge] = useState(0);
  const [msg, setMsg] = useState('');
  const noRef = useRef(null);

  useEffect(() => {
    if (dodge === 0) return;
    if (dodge >= 6) {
      setMsg(t('popup.no_final'));
      return;
    }
    const el = noRef.current;
    if (el) {
      el.style.transform = `translate(${-(Math.random() * 180)}px,${-(Math.random() * 60)}px)`;
    }
  }, [dodge, t]);

  if (!open) return null;

  const onEnter = () => setDodge((d) => (d >= 6 ? d : d + 1));
  const onClickNo = () => {
    if (dodge >= 6) setOpen(false);
  };
  const onClickYes = () => {
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(t('popup.mail_subject'))}`;
  };

  const body = text || 'Вы нашли разработчика! Хотите нанять Алексея?';
  const head = body.split('!')[0] + '!';
  const tail = body.split('!').length > 1 ? body.split('!').slice(1).join('!').trim() : '';

  return (
    <div id="pop" role="dialog" aria-label="Всплывающее окно">
      <div className="t">{title || 'Поздравляем!'}</div>
      <div className="b">
        <p>
          <b>{head}</b>
          <br />
          {tail}
        </p>
        <button id="yes" onClick={onClickYes}>
          {t('popup.yes')}
        </button>
        <button id="no" ref={noRef} onPointerEnter={onEnter} onClick={onClickNo}>
          {msg || t('popup.no')}
        </button>
      </div>
    </div>
  );
}

function BsodTrigger({ label, t }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!shown) return;
    const k = () => setShown(false);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [shown]);

  return (
    <>
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          setShown(true);
        }}
      >
        {label}
      </a>
      {shown && (
        <div
          onClick={() => setShown(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: '#00a',
            color: '#fff',
            font: '18px "Courier New", monospace',
            padding: '8vh 8vw',
            zIndex: 999,
          }}
        >
          <p style={{ background: '#aaa', color: '#00a', display: 'inline-block', padding: '0 8px' }}>
            {t('bsod.tag')}
          </p>
          <p>{t('bsod.line1')}</p>
          <p>{t('bsod.line2')}</p>
        </div>
      )}
    </>
  );
}
