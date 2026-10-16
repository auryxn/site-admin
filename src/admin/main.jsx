import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  User,
  FolderKanban,
  Layers,
  Briefcase,
  Link2,
  Settings as SettingsIcon,
  Languages,
  Inbox,
  LogOut,
  Save,
  Trash2,
  Plus,
  HelpCircle,
} from 'lucide-react';
import './admin.css';

const API = '';
const tokenKey = 'site_admin_token';

const tabs = [
  ['profile', 'Профиль', User],
  ['projects', 'Проекты', FolderKanban],
  ['stack', 'Стек', Layers],
  ['experience', 'Опыт', Briefcase],
  ['links', 'Ссылки', Link2],
  ['settings', 'Настройки', SettingsIcon],
  ['ui_strings', 'UI-строки', Languages],
  ['messages', 'Сообщения', Inbox],
];

const settingsFields = [
  ['counter_start', 'Счётчик (стартовое значение)'],
  ['title_bar', 'Строка заголовка (адресная строка)'],
  ['marquee_text', 'Бегущая строка (текст)'],
  ['projects_note', 'Подпись раздела «Проекты»'],
  ['contacts_note', 'Подпись раздела «Контакты»'],
  ['footer_text', 'Текст подвала'],
  ['badge', 'Бейдж (например, ВЕБ 1.0)'],
  ['popup_title', 'Заголовок всплывающего окна'],
  ['popup_text', 'Текст всплывающего окна'],
];

// Multilingual editing primitives -------------------------------------------
const LANGS = [
  ['ru', 'RU'],
  ['lt', 'LT'],
  ['en', 'EN'],
];

// Three inputs side by side, one per language, bound to <field>_ru/_lt/_en.
// Extra helpers: "RU → LT/EN" copies the Russian value into every language;
// "одно для всех" (sync) mirrors typed input into all three fields.
function MultiText({ label, base, item, onChange, textarea, span }) {
  const [sync, setSync] = useState(false);
  const C = textarea ? 'textarea' : 'input';
  const ruVal = item[`${base}_ru`] ?? '';
  const copyRuToAll = () => {
    for (const [code] of LANGS) onChange(`${base}_${code}`, ruVal);
  };
  const handleChange = (code, value) => {
    if (sync) {
      for (const [c] of LANGS) onChange(`${base}_${c}`, value);
    } else {
      onChange(`${base}_${code}`, value);
    }
  };
  return (
    <div className={`multi ${span || ''}`}>
      <span className="multi-label">
        {label}
        <span className="multi-tools">
          <button type="button" className="mini" onClick={copyRuToAll} title="Скопировать русское значение во все языки">
            RU → LT/EN
          </button>
          <label className="mini-check" title="Ввод синхронизируется во всех языках">
            <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} />
            одно для всех
          </label>
        </span>
      </span>
      <div className="multi-row">
        {LANGS.map(([code, tag]) => (
          <label key={code} className="multi-cell">
            <span className="tag">{tag}</span>
            <C value={item[`${base}_${code}`] ?? ''} onChange={(e) => handleChange(code, e.target.value)} />
          </label>
        ))}
      </div>
    </div>
  );
}

// Three textareas side by side, one per language (bullets: line per item).
function MultiBullets({ item, onChange, span }) {
  const [sync, setSync] = useState(false);
  const asText = (code) => (item[`bullets_${code}`] || []).join('\n');
  const copyRuToAll = () => {
    const ru = asText('ru');
    for (const [code] of LANGS) onChange(`bullets_${code}`, ru.split('\n'));
  };
  const handleChange = (code, value) => {
    if (sync) {
      for (const [c] of LANGS) onChange(`bullets_${c}`, value.split('\n'));
    } else {
      onChange(`bullets_${code}`, value.split('\n'));
    }
  };
  return (
    <div className={`multi ${span || ''}`}>
      <span className="multi-label">
        Пункты (по одному в строке)
        <span className="multi-tools">
          <button type="button" className="mini" onClick={copyRuToAll} title="Скопировать русское значение во все языки">
            RU → LT/EN
          </button>
          <label className="mini-check" title="Ввод синхронизируется во всех языках">
            <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} />
            одно для всех
          </label>
        </span>
      </span>
      <div className="multi-row">
        {LANGS.map(([code, tag]) => (
          <label key={code} className="multi-cell">
            <span className="tag">{tag}</span>
            <textarea value={asText(code)} onChange={(e) => handleChange(code, e.target.value)} />
          </label>
        ))}
      </div>
    </div>
  );
}

// Language tab strip used at panel level in the admin.
function LangTabs({ lang, setLang, extra }) {
  return (
    <span className="lang-tabs">
      {LANGS.map(([code, tag]) => (
        <button key={code} className={lang === code ? 'active' : ''} onClick={() => setLang(code)}>
          {tag}
        </button>
      ))}
      {extra}
    </span>
  );
}

const token = () => localStorage.getItem(tokenKey) || '';
const saveTok = (v) => localStorage.setItem(tokenKey, v);
const clearTok = () => localStorage.removeItem(tokenKey);

// Ping open public-site tabs (same browser) that content changed, so they can
// re-fetch immediately instead of waiting for the next poll tick.
const CONTENT_UPDATED_KEY = 'site_content_updated';
function signalContentUpdated() {
  try {
    localStorage.setItem(CONTENT_UPDATED_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

async function request(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false && token()) headers.Authorization = `Bearer ${token()}`;
  const res = await fetch(API + path, {
    ...opts,
    headers,
    body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body,
  });
  if (res.status === 401) {
    clearTok();
    location.reload();
    throw new Error('Сессия истекла');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    (async () => {
      if (!token()) return setChecking(false);
      try {
        const r = await request('/api/auth/me');
        setUser(r.admin);
      } catch {
        /* ignore */
      }
      setChecking(false);
    })();
  }, []);
  if (checking) return <Shell><p className="muted">Проверка сессии…</p></Shell>;
  if (!user) return <Login onLogin={setUser} />;
  return <Dashboard user={user} onLogout={() => { clearTok(); setUser(null); }} />;
}

function Shell({ children }) {
  return <div className="app-shell">{children}</div>;
}

function Login({ onLogin }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await request('/api/auth/login', { method: 'POST', auth: false, body: { username, password } });
      saveTok(r.token);
      onLogin(r.admin);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell>
      <form className="login-card" onSubmit={submit}>
        <p className="eyebrow">алексей волков</p>
        <h1>Админ-панель</h1>
        <p className="muted">По умолчанию: admin / admin123</p>
        {err && <div className="alert">{err}</div>}
        <label>
          Логин
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          Пароль
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </Shell>
  );
}

function Dashboard({ user, onLogout }) {
  const [tab, setTab] = useState('profile');
  const Active = {
    profile: ProfilePanel,
    projects: ProjectsPanel,
    stack: StackPanel,
    experience: ExperiencePanel,
    links: LinksPanel,
    settings: SettingsPanel,
    ui_strings: UiStringsPanel,
    messages: MessagesPanel,
  }[tab];
  return (
    <Shell>
      <div className="layout">
        <aside className="sidebar">
          <div>
            <p className="eyebrow">алексей волков</p>
            <h2>Админ</h2>
            <p className="muted">Вы вошли как {user.username}</p>
          </div>
          <nav>
            {tabs.map(([id, label, Icon]) => (
              <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
                <Icon size={17} />
                {label}
              </button>
            ))}
          </nav>
          <button className="logout" onClick={onLogout}>
            <LogOut size={16} />
            Выйти
          </button>
        </aside>
        <main>
          <Active />
        </main>
      </div>
    </Shell>
  );
}

function Panel({ title, subtitle, children, action }) {
  return (
    <section className="panel">
      <header>
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Text({ label, value, onChange, type = 'text', textarea = false, span }) {
  const C = textarea ? 'textarea' : 'input';
  return (
    <label className={span ? span : ''}>
      {label}
      <C type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function RowActions({ onSave, onDelete, busy }) {
  return (
    <div className="row-actions">
      <button className="primary small" onClick={onSave} disabled={busy}>
        <Save size={14} />
        Сохранить
      </button>
      {onDelete && (
        <button className="danger small" onClick={onDelete}>
          <Trash2 size={14} />
          Удалить
        </button>
      )}
    </div>
  );
}

function useResource(path) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const reload = async () => {
    setErr('');
    setLoading(true);
    try {
      setItems(await request(path));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return { items, setItems, loading, err, reload };
}

function Status({ loading, err, empty }) {
  if (loading) return <p className="muted">Загрузка…</p>;
  if (err) return <div className="alert">{err}</div>;
  if (empty) return <p className="muted">Пока пусто.</p>;
  return null;
}

function useSaver(onSaved) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async (fn) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
      await onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, err, run };
}

// --------------------------- ПРОФИЛЬ ---------------------------
function ProfilePanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const [lang, setLang] = useState('ru');
  useEffect(() => {
    request('/api/admin/profile')
      .then(setData)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));
  async function save() {
    setSaved(false);
    setErr('');
    try {
      const r = await request('/api/admin/profile', { method: 'PATCH', body: data });
      setData(r);
      setSaved(true);
      signalContentUpdated();
      setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      setErr(e.message);
    }
  }
  return (
    <Panel
      title="Профиль"
      subtitle="Имя и тексты переводятся по языку; e-mail общий для всех языков"
      action={<LangTabs lang={lang} setLang={setLang} />}
    >
      <Status loading={loading} err={err} />
      {!loading && data && (
        <>
          <div className="settings-grid">
            <Text label="E-mail" value={data.email} onChange={(v) => set('email', v)} />
          </div>
          <MultiText label="Имя (шапка и футер)" base="name" item={data} onChange={set} />
          <MultiText label="Должность (title)" base="title" item={data} onChange={set} />
          <MultiText label="Стаж (years)" base="years" item={data} onChange={set} />
          <MultiText label="Статус (например: ИЩУ РАБОТУ)" base="status" item={data} onChange={set} />
          <MultiText
            label="Био-текст (после «Пишу сайты и сервисы…»)"
            base="bio_text"
            item={data}
            onChange={set}
            textarea
          />
          <p className="muted">Активная вкладка редактирования: {lang.toUpperCase()} (сохраняется всё сразу)</p>
          <button className="primary" onClick={save}>
            <Save size={16} />
            Сохранить
          </button>
          {saved && <span className="saved">Сохранено</span>}
        </>
      )}
    </Panel>
  );
}

// --------------------------- ПРОЕКТЫ ---------------------------
function ProjectsPanel() {
  const r = useResource('/api/admin/projects');
  const blank = { title: '', description: '', stack: '', bullets: [], sort_order: 0 };
  return (
    <Panel
      title="Проекты"
      subtitle="Карточки-«.exe» на сайте. Порядок задаётся полем «Порядок»"
      action={
        <button className="primary" onClick={() => r.setItems([blank, ...r.items])}>
          <Plus size={16} />
          Добавить проект
        </button>
      }
    >
      <Status loading={r.loading} err={r.err} empty={!r.items.length} />
      <div className="cards">
        {r.items.map((it, i) => (
          <ProjectsCard
            key={it.id || `new-${i}`}
            item={it}
            onChange={(v) => r.setItems(r.items.map((x, n) => (n === i ? v : x)))}
            onSaved={r.reload}
            onDelete={
              it.id
                ? async () => {
                    if (confirm('Удалить проект?')) {
                      await request(`/api/admin/projects/${it.id}`, { method: 'DELETE' });
                      r.reload();
                    }
                  }
                : null
            }
          />
        ))}
      </div>
    </Panel>
  );
}

function ProjectsCard({ item, onChange, onSaved, onDelete }) {
  const { busy, err, run } = useSaver(onSaved);
  const set = (k, v) => onChange({ ...item, [k]: v });
  const save = () =>
    run(() =>
      request(item.id ? `/api/admin/projects/${item.id}` : '/api/admin/projects', {
        method: item.id ? 'PATCH' : 'POST',
        body: item,
      })
    );
  return (
    <article className="card">
      {err && <div className="alert">{err}</div>}
      <div className="grid-card">
        <MultiText label="Название" base="title" item={item} onChange={set} />
        <MultiText label="Стек" base="stack" item={item} onChange={set} />
        <Text label="Порядок" type="number" value={item.sort_order} onChange={(v) => set('sort_order', Number(v))} />
        <MultiText label="Описание" base="description" item={item} onChange={set} textarea />
        <MultiBullets item={item} onChange={set} />
        <RowActions onSave={save} onDelete={onDelete} busy={busy} />
      </div>
    </article>
  );
}

// --------------------------- СТЕК ---------------------------
function StackPanel() {
  const r = useResource('/api/admin/stack');
  const blank = { name: '', sort_order: 0 };
  return (
    <Panel
      title="Стек"
      subtitle="Список тегов в колонках"
      action={
        <button className="primary" onClick={() => r.setItems([blank, ...r.items])}>
          <Plus size={16} />
          Добавить тег
        </button>
      }
    >
      <Status loading={r.loading} err={r.err} empty={!r.items.length} />
      <div className="cards">
        {r.items.map((it, i) => (
          <StackCard
            key={it.id || `new-${i}`}
            item={it}
            onChange={(v) => r.setItems(r.items.map((x, n) => (n === i ? v : x)))}
            onSaved={r.reload}
            onDelete={
              it.id
                ? async () => {
                    if (confirm('Удалить тег?')) {
                      await request(`/api/admin/stack/${it.id}`, { method: 'DELETE' });
                      r.reload();
                    }
                  }
                : null
            }
          />
        ))}
      </div>
    </Panel>
  );
}

function StackCard({ item, onChange, onSaved, onDelete }) {
  const { busy, err, run } = useSaver(onSaved);
  const set = (k, v) => onChange({ ...item, [k]: v });
  const save = () =>
    run(() =>
      request(item.id ? `/api/admin/stack/${item.id}` : '/api/admin/stack', {
        method: item.id ? 'PATCH' : 'POST',
        body: item,
      })
    );
  return (
    <article className="card">
      {err && <div className="alert">{err}</div>}
      <div className="grid-card">
        <MultiText label="Название" base="name" item={item} onChange={set} />
        <Text label="Порядок" type="number" value={item.sort_order} onChange={(v) => set('sort_order', Number(v))} />
        <RowActions onSave={save} onDelete={onDelete} busy={busy} />
      </div>
    </article>
  );
}

// --------------------------- ОПЫТ ---------------------------
function ExperiencePanel() {
  const r = useResource('/api/admin/experience');
  const blank = { period: '', company: '', description: '', sort_order: 0 };
  return (
    <Panel
      title="Опыт"
      subtitle="Строки таблицы опыта"
      action={
        <button className="primary" onClick={() => r.setItems([blank, ...r.items])}>
          <Plus size={16} />
          Добавить строку
        </button>
      }
    >
      <Status loading={r.loading} err={r.err} empty={!r.items.length} />
      <div className="cards">
        {r.items.map((it, i) => (
          <ExperienceCard
            key={it.id || `new-${i}`}
            item={it}
            onChange={(v) => r.setItems(r.items.map((x, n) => (n === i ? v : x)))}
            onSaved={r.reload}
            onDelete={
              it.id
                ? async () => {
                    if (confirm('Удалить строку опыта?')) {
                      await request(`/api/admin/experience/${it.id}`, { method: 'DELETE' });
                      r.reload();
                    }
                  }
                : null
            }
          />
        ))}
      </div>
    </Panel>
  );
}

function ExperienceCard({ item, onChange, onSaved, onDelete }) {
  const { busy, err, run } = useSaver(onSaved);
  const set = (k, v) => onChange({ ...item, [k]: v });
  const save = () =>
    run(() =>
      request(item.id ? `/api/admin/experience/${item.id}` : '/api/admin/experience', {
        method: item.id ? 'PATCH' : 'POST',
        body: item,
      })
    );
  return (
    <article className="card">
      {err && <div className="alert">{err}</div>}
      <div className="grid-card">
        <Text label="Когда (период)" value={item.period} onChange={(v) => set('period', v)} />
        <MultiText label="Где (компания)" base="company" item={item} onChange={set} />
        <Text label="Порядок" type="number" value={item.sort_order} onChange={(v) => set('sort_order', Number(v))} />
        <MultiText label="Что делал" base="description" item={item} onChange={set} textarea />
        <RowActions onSave={save} onDelete={onDelete} busy={busy} />
      </div>
    </article>
  );
}

// --------------------------- ССЫЛКИ ---------------------------
function LinksPanel() {
  const r = useResource('/api/admin/links');
  const blank = { label: '', url: '', sort_order: 0 };
  return (
    <Panel
      title="Ссылки"
      subtitle="GitHub / Telegram / LinkedIn / резюме"
      action={
        <button className="primary" onClick={() => r.setItems([blank, ...r.items])}>
          <Plus size={16} />
          Добавить ссылку
        </button>
      }
    >
      <Status loading={r.loading} err={r.err} empty={!r.items.length} />
      <div className="cards">
        {r.items.map((it, i) => (
          <LinkCard
            key={it.id || `new-${i}`}
            item={it}
            onChange={(v) => r.setItems(r.items.map((x, n) => (n === i ? v : x)))}
            onSaved={r.reload}
            onDelete={
              it.id
                ? async () => {
                    if (confirm('Удалить ссылку?')) {
                      await request(`/api/admin/links/${it.id}`, { method: 'DELETE' });
                      r.reload();
                    }
                  }
                : null
            }
          />
        ))}
      </div>
    </Panel>
  );
}

function LinkCard({ item, onChange, onSaved, onDelete }) {
  const { busy, err, run } = useSaver(onSaved);
  const set = (k, v) => onChange({ ...item, [k]: v });
  const save = () =>
    run(() =>
      request(item.id ? `/api/admin/links/${item.id}` : '/api/admin/links', {
        method: item.id ? 'PATCH' : 'POST',
        body: item,
      })
    );
  return (
    <article className="card">
      {err && <div className="alert">{err}</div>}
      <div className="grid-card">
        <MultiText label="Подпись" base="label" item={item} onChange={set} />
        <Text label="URL" value={item.url} onChange={(v) => set('url', v)} />
        <Text label="Порядок" type="number" value={item.sort_order} onChange={(v) => set('sort_order', Number(v))} />
        <RowActions onSave={save} onDelete={onDelete} busy={busy} />
      </div>
    </article>
  );
}

// --------------------------- НАСТРОЙКИ ---------------------------
function SettingsPanel() {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    request('/api/admin/settings')
      .then((d) => setData(d || {}))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);
  const setLangVal = (key, lang, v) =>
    setData((d) => ({ ...d, [key]: { ru: '', lt: '', en: '', ...(d[key] || {}), [lang]: v } }));
  async function save() {
    setSaved(false);
    setErr('');
    try {
      const r = await request('/api/admin/settings', { method: 'PUT', body: data });
      setData(r || {});
      setSaved(true);
      signalContentUpdated();
      setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      setErr(e.message);
    }
  }
  const TEXTAREA_KEYS = ['footer_text', 'popup_text', 'projects_note', 'contacts_note'];
  return (
    <Panel title="Настройки" subtitle="Счётчик и текстовая «обвязка» сайта — отдельно для каждого языка">
      <Status loading={loading} err={err} />
      {!loading && (
        <div className="settings-grid">
          {settingsFields.map(([k, label]) => {
            const byLang = data[k] || {};
            const isCounter = k === 'counter_start';
            return (
              <label key={k} className={isCounter ? '' : 'span2'}>
                {label}
                <div className="multi-row">
                  {LANGS.map(([code, tag]) => (
                    <span key={code} className="multi-cell">
                      <span className="tag">{tag}</span>
                      {TEXTAREA_KEYS.includes(k) ? (
                        <textarea
                          value={byLang[code] || ''}
                          onChange={(e) => setLangVal(k, code, e.target.value)}
                        />
                      ) : (
                        <input value={byLang[code] || ''} onChange={(e) => setLangVal(k, code, e.target.value)} />
                      )}
                    </span>
                  ))}
                </div>
              </label>
            );
          })}
        </div>
      )}
      <button className="primary" onClick={save}>
        <Save size={16} />
        Сохранить настройки
      </button>
      {saved && <span className="saved">Сохранено</span>}
    </Panel>
  );
}

// --------------------------- UI-СТРОКИ ---------------------------
function UiStringsPanel() {
  const r = useResource('/api/admin/ui_strings');
  const [drafts, setDrafts] = useState({});
  useEffect(() => {
    const m = {};
    for (const it of r.items) m[it.key] = { ru: it.ru, lt: it.lt, en: it.en };
    setDrafts(m);
  }, [r.items]);
  async function save(key) {
    const d = drafts[key];
    if (!d) return;
    await request('/api/admin/ui_strings', { method: 'PUT', body: { key, ...d } });
    r.reload();
  }
  const set = (key, lang, v) =>
    setDrafts((m) => ({ ...m, [key]: { ru: '', lt: '', en: '', ...(m[key] || {}), [lang]: v } }));
  return (
    <Panel
      title="UI-строки"
      subtitle="Статичные подписи интерфейса (навигация, разделы, пасхалки) для всех языков"
    >
      <Status loading={r.loading} err={r.err} empty={!r.items.length} />
      <div className="cards">
        {r.items.map((it) => {
          const d = drafts[it.key] || {};
          return (
            <article className="card" key={it.key}>
              <div className="grid-card">
                <p className="eyebrow">{it.key}</p>
                <div className="multi-row">
                  {LANGS.map(([code, tag]) => (
                    <span key={code} className="multi-cell">
                      <span className="tag">{tag}</span>
                      <input value={d[code] || ''} onChange={(e) => set(it.key, code, e.target.value)} />
                    </span>
                  ))}
                </div>
                <RowActions onSave={() => save(it.key)} busy={false} />
              </div>
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

// --------------------------- СООБЩЕНИЯ ---------------------------
function MessagesPanel() {
  const r = useResource('/api/admin/messages');
  async function setStatus(id, s) {
    await request(`/api/admin/messages/${id}`, { method: 'PATCH', body: { status: s } });
    r.reload();
  }
  async function del(id) {
    if (!confirm('Удалить сообщение?')) return;
    await request(`/api/admin/messages/${id}`, { method: 'DELETE' });
    r.reload();
  }
  return (
    <Panel title="Сообщения" subtitle="Оставленные через публичную форму">
      <Status loading={r.loading} err={r.err} empty={!r.items.length} />
      <div className="cards">
        {r.items.map((x) => (
          <article className="card" key={x.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
              <div>
                <b>{x.name}</b>
                <span className="badge">{x.contact}</span>
                <p className="muted">{x.created_at}</p>
                <p style={{ marginTop: 8 }}>{x.body}</p>
              </div>
              <div className="status-toggle">
                <select value={x.status} onChange={(e) => setStatus(x.id, e.target.value)}>
                  <option value="new">новое</option>
                  <option value="read">прочитано</option>
                  <option value="done">обработано</option>
                </select>
                <button className="danger small" onClick={() => del(x.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </Panel>
  );
}

createRoot(document.getElementById('root')).render(<App />);
