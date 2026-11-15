import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';

// ===== 설정 =====
const cfg = window.SUPABASE_CONFIG;
if (!cfg || !cfg.url || !cfg.key) {
  document.getElementById('app').textContent = 'Supabase 설정을 불러오지 못했습니다. node server.js 로 실행했는지 확인하세요.';
  throw new Error('SUPABASE_CONFIG 없음');
}
const sb = createClient(cfg.url, cfg.key);

const BUCKET = 'post-images';
const PAGE_SIZE = 20;
const MAX_IMAGE = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const POST_SELECT =
  'id, user_id, content, image_path, created_at, updated_at, author:profiles!posts_user_id_fkey(nickname), comments(count), post_likes(count)';

// ===== 상태 =====
const state = {
  user: null, // auth user
  me: null, // profiles 행
};

// ===== DOM 도우미 =====
const $app = document.getElementById('app');
const $nav = document.getElementById('nav-actions');
const $modalRoot = document.getElementById('modal-root');
const $toast = document.getElementById('toast');

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // 고정 SVG 아이콘에만 사용
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICON = {
  heart: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 20.6s-7.6-4.6-9.4-9.3C1.4 8 3.6 4.5 7.1 4.5c2 0 3.6 1.1 4.9 2.8 1.3-1.7 2.9-2.8 4.9-2.8 3.5 0 5.7 3.5 4.5 6.8-1.8 4.7-9.4 9.3-9.4 9.3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  heartFill: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 20.6s-7.6-4.6-9.4-9.3C1.4 8 3.6 4.5 7.1 4.5c2 0 3.6 1.1 4.9 2.8 1.3-1.7 2.9-2.8 4.9-2.8 3.5 0 5.7 3.5 4.5 6.8-1.8 4.7-9.4 9.3-9.4 9.3z" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  comment: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M20.5 11.6a8.4 8.4 0 0 1-12.3 7.5L3.5 20.5l1.4-4.5A8.4 8.4 0 1 1 20.5 11.6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  more: '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  image: '<svg viewBox="0 0 24 24" width="40" height="40"><rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="10" r="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 17l5-5 4 4 3-3 5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
};

function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => $toast.classList.remove('show'), 2600);
}

function fail(err, fallback = '문제가 생겼습니다. 다시 시도해 주세요.') {
  console.error(err);
  toast(err?.userMessage || fallback);
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return '방금 전';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

function isEdited(row) {
  return new Date(row.updated_at) - new Date(row.created_at) > 1000;
}

function avatar(userId, nickname, size = 32) {
  let hash = 0;
  for (const ch of userId || '') hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const el = h('span', { class: 'avatar' }, (nickname || '?').slice(0, 1).toUpperCase());
  el.style.cssText = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;background:linear-gradient(135deg,hsl(${hue} 75% 62%),hsl(${(hue + 40) % 360} 80% 52%))`;
  return el;
}

function imageUrl(path) {
  return path ? sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null;
}

const countOf = (rel) => (Array.isArray(rel) && rel[0] ? rel[0].count : 0);

function requireLogin() {
  if (state.user) return true;
  toast('로그인이 필요합니다');
  closeModal();
  location.hash = '#/login';
  return false;
}

// ===== 모달 =====
function openModal(content, { wide = false, onClose } = {}) {
  closeModal();
  const box = h('div', { class: `modal${wide ? ' modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true' }, content);
  const overlay = h(
    'div',
    { class: 'overlay', onClick: (e) => e.target === overlay && closeModal() },
    h('button', { class: 'overlay-close', 'aria-label': '닫기', html: ICON.close, onClick: closeModal }),
    box,
  );
  overlay._onClose = onClose;
  $modalRoot.append(overlay);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => overlay.classList.add('open'));
  return box;
}

function closeModal() {
  const overlay = $modalRoot.firstChild;
  if (!overlay) return;
  $modalRoot.innerHTML = '';
  document.body.classList.remove('no-scroll');
  overlay._onClose?.();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeActionSheet();
    closeModal();
  }
});

// 액션 시트 (··· 메뉴)
function openActionSheet(items) {
  closeActionSheet();
  const sheet = h(
    'div',
    { class: 'sheet-overlay', onClick: (e) => e.target === sheet && closeActionSheet() },
    h(
      'div',
      { class: 'sheet' },
      items.map((it) =>
        h('button', { class: `sheet-item${it.danger ? ' danger' : ''}`, onClick: () => (closeActionSheet(), it.onClick()) }, it.label),
      ),
      h('button', { class: 'sheet-item', onClick: closeActionSheet }, '취소'),
    ),
  );
  document.body.append(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
}
function closeActionSheet() {
  document.querySelector('.sheet-overlay')?.remove();
}

// ===== 인증 =====
async function loadMe() {
  if (!state.user) {
    state.me = null;
    return;
  }
  const { data, error } = await sb.from('profiles').select('id, nickname').eq('id', state.user.id).maybeSingle();
  if (error) console.error(error);
  state.me = data;
}

function authErrorMessage(error) {
  const m = (error?.message || '').toLowerCase();
  if (m.includes('invalid login credentials')) return '이메일 또는 비밀번호가 올바르지 않습니다.';
  if (m.includes('already registered') || m.includes('already been registered')) return '이미 가입된 이메일입니다.';
  if (m.includes('database error saving new user') || m.includes('nickname')) return '이미 사용 중인 닉네임입니다.';
  if (m.includes('password')) return '비밀번호는 6자 이상이어야 합니다.';
  if (m.includes('email') && m.includes('invalid')) return '이메일 형식이 올바르지 않습니다.';
  if (m.includes('rate limit')) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  return '요청을 처리하지 못했습니다. 다시 시도해 주세요.';
}

function renderLogin() {
  if (state.user) {
    location.hash = '#/';
    return;
  }
  let mode = 'login';
  const errorEl = h('p', { class: 'form-error' });
  const nickField = h('label', { class: 'field' }, h('span', {}, '닉네임'), h('input', { name: 'nickname', maxlength: 20, autocomplete: 'nickname', placeholder: '2~20자' }));
  const submitBtn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, '로그인');
  const tabLogin = h('button', { type: 'button', class: 'seg active', onClick: () => setMode('login') }, '로그인');
  const tabSignup = h('button', { type: 'button', class: 'seg', onClick: () => setMode('signup') }, '회원가입');

  const form = h(
    'form',
    { class: 'auth-form', onSubmit: submit },
    h('label', { class: 'field' }, h('span', {}, '이메일'), h('input', { name: 'email', type: 'email', required: true, autocomplete: 'email', placeholder: 'you@school.ac.kr' })),
    h('label', { class: 'field' }, h('span', {}, '비밀번호'), h('input', { name: 'password', type: 'password', required: true, minlength: 6, autocomplete: 'current-password', placeholder: '6자 이상' })),
    nickField,
    errorEl,
    submitBtn,
  );

  function setMode(next) {
    mode = next;
    tabLogin.classList.toggle('active', mode === 'login');
    tabSignup.classList.toggle('active', mode === 'signup');
    nickField.hidden = mode === 'login';
    nickField.querySelector('input').required = mode === 'signup';
    form.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    submitBtn.textContent = mode === 'login' ? '로그인' : '가입하기';
    errorEl.textContent = '';
  }

  async function submit(e) {
    e.preventDefault();
    errorEl.textContent = '';
    const email = form.email.value.trim();
    const password = form.password.value;
    submitBtn.disabled = true;
    try {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const nickname = form.nickname.value.trim();
        if (nickname.length < 2 || nickname.length > 20) {
          errorEl.textContent = '닉네임은 2~20자로 입력해 주세요.';
          return;
        }
        const { data: taken } = await sb.from('profiles').select('id').eq('nickname', nickname).maybeSingle();
        if (taken) {
          errorEl.textContent = '이미 사용 중인 닉네임입니다.';
          return;
        }
        const { error } = await sb.auth.signUp({ email, password, options: { data: { nickname } } });
        if (error) throw error;
        toast(`${nickname}님, 환영합니다!`);
      }
      location.hash = '#/';
    } catch (err) {
      console.error(err);
      errorEl.textContent = authErrorMessage(err);
    } finally {
      submitBtn.disabled = false;
    }
  }

  setMode('login');
  $app.replaceChildren(
    h(
      'section',
      { class: 'auth' },
      h('h1', { class: 'auth-title' }, '캠퍼스'),
      h('p', { class: 'auth-sub' }, '우리 학교 친구들의 일상을 나눠 보세요.'),
      h('div', { class: 'card auth-card' }, h('div', { class: 'segmented' }, tabLogin, tabSignup), form),
    ),
  );
}

async function logout() {
  await sb.auth.signOut();
  toast('로그아웃했습니다');
  location.hash = '#/';
}

// ===== 내비게이션 =====
function renderNav() {
  if (state.user) {
    $nav.replaceChildren(
      h('button', { class: 'icon-btn', 'aria-label': '새 게시물', title: '새 게시물', html: ICON.plus, onClick: () => openComposer() }),
      h('a', { class: 'nav-me', href: `#/profile/${state.user.id}` }, avatar(state.user.id, state.me?.nickname, 28), h('span', {}, state.me?.nickname || '내 프로필')),
      h('button', { class: 'btn btn-ghost btn-sm', onClick: logout }, '로그아웃'),
    );
  } else {
    $nav.replaceChildren(h('a', { class: 'btn btn-primary btn-sm', href: '#/login' }, '로그인'));
  }
}

// ===== 좋아요 =====
async function myLikedPostIds(postIds) {
  if (!state.user || !postIds.length) return new Set();
  const { data, error } = await sb.from('post_likes').select('post_id').eq('user_id', state.user.id).in('post_id', postIds);
  if (error) console.error(error);
  return new Set((data || []).map((r) => r.post_id));
}

async function myLikedCommentIds(commentIds) {
  if (!state.user || !commentIds.length) return new Set();
  const { data, error } = await sb.from('comment_likes').select('comment_id').eq('user_id', state.user.id).in('comment_id', commentIds);
  if (error) console.error(error);
  return new Set((data || []).map((r) => r.comment_id));
}

/** 하트 버튼 + 숫자. like/unlike 은 서버 호출 함수. */
function likeButton({ liked, count, like, unlike, small = false, onChange }) {
  const s = { liked, count, busy: false };
  const btn = h('button', { class: `like-btn${small ? ' small' : ''}`, 'aria-label': '좋아요' });
  const num = h('span', { class: 'like-count' });
  const paint = () => {
    btn.classList.toggle('liked', s.liked);
    btn.innerHTML = s.liked ? ICON.heartFill : ICON.heart;
    btn.setAttribute('aria-pressed', String(s.liked));
    num.textContent = s.count > 0 ? (small ? `좋아요 ${s.count}개` : `좋아요 ${s.count}개`) : small ? '' : '첫 좋아요를 눌러 보세요';
  };
  async function toggle(forceLike = false) {
    if (!requireLogin() || s.busy) return;
    if (forceLike && s.liked) return;
    s.busy = true;
    const next = !s.liked;
    s.liked = next;
    s.count += next ? 1 : -1;
    paint();
    btn.classList.remove('pop');
    void btn.offsetWidth;
    if (next) btn.classList.add('pop');
    const { error } = next ? await like() : await unlike();
    if (error && error.code !== '23505') {
      s.liked = !next;
      s.count += next ? -1 : 1;
      paint();
      fail(error, '좋아요를 처리하지 못했습니다.');
    }
    s.busy = false;
    onChange?.(s);
  }
  btn.addEventListener('click', () => toggle());
  paint();
  return { btn, num, toggle, likeOnly: () => toggle(true) };
}

const likePost = (postId) => sb.from('post_likes').insert({ post_id: postId });
const unlikePost = (postId) => sb.from('post_likes').delete().eq('post_id', postId).eq('user_id', state.user.id);
const likeComment = (id) => sb.from('comment_likes').insert({ comment_id: id });
const unlikeComment = (id) => sb.from('comment_likes').delete().eq('comment_id', id).eq('user_id', state.user.id);

// ===== 피드 =====
let feedOffset = 0;

async function renderFeed() {
  feedOffset = 0;
  const list = h('div', { class: 'feed' });
  const moreBtn = h('button', { class: 'btn btn-ghost btn-block', hidden: true, onClick: () => loadMore() }, '더 보기');
  const head = state.user
    ? h(
        'button',
        { class: 'card composer-cta', onClick: () => openComposer() },
        avatar(state.user.id, state.me?.nickname, 36),
        h('span', {}, `${state.me?.nickname || ''}님, 오늘 어떤 일이 있었나요?`),
      )
    : h('div', { class: 'card hero' }, h('h2', {}, '우리 학교의 오늘'), h('p', {}, '로그인하고 사진과 이야기를 나눠 보세요.'), h('a', { class: 'btn btn-primary', href: '#/login' }, '시작하기'));

  $app.replaceChildren(head, list, moreBtn);
  list.append(h('div', { class: 'loading' }, '불러오는 중…'));

  async function loadMore() {
    moreBtn.disabled = true;
    const { data, error } = await sb
      .from('posts')
      .select(POST_SELECT)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(feedOffset, feedOffset + PAGE_SIZE - 1);
    list.querySelector('.loading')?.remove();
    moreBtn.disabled = false;
    if (error) return fail(error, '피드를 불러오지 못했습니다.');
    const liked = await myLikedPostIds(data.map((p) => p.id));
    for (const p of data) list.append(postCard(p, liked.has(p.id)));
    feedOffset += data.length;
    moreBtn.hidden = data.length < PAGE_SIZE;
    if (feedOffset === 0) list.append(h('div', { class: 'empty card' }, h('p', {}, '아직 게시물이 없어요.'), h('p', { class: 'muted' }, '첫 번째 이야기를 남겨 보세요!')));
  }
  await loadMore();
}

function postMenu(post) {
  if (!state.user || post.user_id !== state.user.id) return null;
  return h('button', {
    class: 'icon-btn',
    'aria-label': '더 보기',
    html: ICON.more,
    onClick: (e) => {
      e.stopPropagation();
      openActionSheet([
        { label: '수정', onClick: () => openComposer(post) },
        { label: '삭제', danger: true, onClick: () => deletePost(post) },
      ]);
    },
  });
}

function authorLink(userId, nickname, size = 32) {
  return h('a', { class: 'author', href: `#/profile/${userId}`, onClick: () => closeModal() }, avatar(userId, nickname, size), h('strong', {}, nickname || '알 수 없음'));
}

function postCard(post, liked) {
  const nickname = post.author?.nickname;
  const url = imageUrl(post.image_path);
  const commentCount = countOf(post.comments);
  const lk = likeButton({ liked, count: countOf(post.post_likes), like: () => likePost(post.id), unlike: () => unlikePost(post.id) });

  const media = url ? h('div', { class: 'post-media' }, h('img', { src: url, alt: '', loading: 'lazy' }), h('span', { class: 'big-heart', html: ICON.heartFill })) : null;
  if (media) {
    media.addEventListener('dblclick', () => {
      const heart = media.querySelector('.big-heart');
      heart.classList.remove('show');
      void heart.offsetWidth;
      heart.classList.add('show');
      lk.likeOnly();
    });
  }

  const card = h(
    'article',
    { class: 'card post' },
    h('header', { class: 'post-head' }, authorLink(post.user_id, nickname), h('span', { class: 'muted dot' }, timeAgo(post.created_at)), h('span', { class: 'spacer' }), postMenu(post)),
    media,
    !url ? h('div', { class: 'post-text-only' }, post.content) : null,
    h(
      'div',
      { class: 'post-actions' },
      lk.btn,
      h('button', { class: 'icon-btn', 'aria-label': '댓글', html: ICON.comment, onClick: () => openPostDetail(post.id) }),
    ),
    h('div', { class: 'post-body' }, lk.num),
    url ? h('p', { class: 'post-caption' }, h('a', { class: 'caption-author', href: `#/profile/${post.user_id}` }, nickname || ''), ' ', post.content) : null,
    isEdited(post) ? h('p', { class: 'edited muted' }, '수정됨') : null,
    h('button', { class: 'link-btn muted', onClick: () => openPostDetail(post.id) }, commentCount ? `댓글 ${commentCount}개 모두 보기` : '댓글 달기'),
  );
  return card;
}

// ===== 작성 / 수정 =====
function openComposer(post = null) {
  if (!requireLogin()) return;
  const editing = !!post;
  let file = null;
  let removeImage = false;
  let previewUrl = editing ? imageUrl(post.image_path) : null;

  const fileInput = h('input', { type: 'file', accept: IMAGE_TYPES.join(','), hidden: true, onChange: onFile });
  const preview = h('div', { class: 'composer-media' });
  const textarea = h('textarea', { maxlength: 2000, rows: 6, placeholder: '문구를 입력하세요…', required: true });
  textarea.value = editing ? post.content : '';
  const counter = h('span', { class: 'muted counter' });
  const submitBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, editing ? '저장' : '공유하기');
  const updateCounter = () => (counter.textContent = `${textarea.value.length} / 2,000`);
  textarea.addEventListener('input', updateCounter);
  updateCounter();

  function paintPreview() {
    preview.replaceChildren();
    if (previewUrl) {
      preview.append(
        h('img', { src: previewUrl, alt: '미리보기' }),
        h('div', { class: 'composer-media-actions' },
          h('button', { type: 'button', class: 'btn btn-glass btn-sm', onClick: () => fileInput.click() }, '사진 바꾸기'),
          h('button', { type: 'button', class: 'btn btn-glass btn-sm', onClick: clearImage }, '사진 빼기'),
        ),
      );
    } else {
      preview.append(
        h('button', { type: 'button', class: 'composer-drop', onClick: () => fileInput.click() }, h('span', { html: ICON.image }), h('span', {}, '사진 추가 (선택)'), h('span', { class: 'muted small' }, 'JPG · PNG · WEBP, 5MB 이하')),
      );
    }
  }

  function onFile() {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type)) return toast('JPG, PNG, WEBP 사진만 올릴 수 있어요');
    if (f.size > MAX_IMAGE) return toast('사진은 5MB 이하만 올릴 수 있어요');
    file = f;
    removeImage = false;
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(f);
    paintPreview();
  }

  function clearImage() {
    file = null;
    removeImage = true;
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    paintPreview();
  }

  async function submit(e) {
    e.preventDefault();
    const content = textarea.value.trim();
    if (!content) return toast('내용을 입력해 주세요');
    submitBtn.disabled = true;
    submitBtn.textContent = '올리는 중…';
    let uploaded = null;
    try {
      if (file) {
        const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
        uploaded = `${state.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await sb.storage.from(BUCKET).upload(uploaded, file, { contentType: file.type });
        if (error) throw Object.assign(error, { userMessage: '사진을 올리지 못했습니다.' });
      }
      if (editing) {
        const patch = { content };
        if (uploaded) patch.image_path = uploaded;
        else if (removeImage) patch.image_path = null;
        const { data, error } = await sb.from('posts').update(patch).eq('id', post.id).select('id');
        if (error) throw error;
        if (!data.length) throw Object.assign(new Error('0 rows'), { userMessage: '내 글만 수정할 수 있어요.' });
        if ((uploaded || removeImage) && post.image_path) await sb.storage.from(BUCKET).remove([post.image_path]);
        toast('수정했습니다');
      } else {
        const { error } = await sb.from('posts').insert({ content, image_path: uploaded });
        if (error) throw error;
        toast('게시물을 공유했습니다');
      }
      uploaded = null;
      closeModal();
      route();
    } catch (err) {
      if (uploaded) await sb.storage.from(BUCKET).remove([uploaded]);
      fail(err, '게시물을 저장하지 못했습니다.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = editing ? '저장' : '공유하기';
    }
  }

  paintPreview();
  openModal(
    h(
      'form',
      { class: 'composer', onSubmit: submit },
      h('header', { class: 'modal-head' }, h('h3', {}, editing ? '게시물 수정' : '새 게시물'), submitBtn),
      preview,
      fileInput,
      h('div', { class: 'composer-text' }, h('div', { class: 'composer-author' }, avatar(state.user.id, state.me?.nickname, 28), h('strong', {}, state.me?.nickname || '')), textarea, counter),
    ),
    { onClose: () => previewUrl?.startsWith('blob:') && URL.revokeObjectURL(previewUrl) },
  );
  textarea.focus();
}

async function deletePost(post) {
  if (!confirm('이 게시물을 삭제할까요? 댓글과 좋아요도 함께 사라집니다.')) return;
  const { data, error } = await sb.from('posts').delete().eq('id', post.id).select('id');
  if (error) return fail(error, '삭제하지 못했습니다.');
  if (!data.length) return toast('내 글만 삭제할 수 있어요');
  if (post.image_path) await sb.storage.from(BUCKET).remove([post.image_path]);
  toast('삭제했습니다');
  closeModal();
  route();
}

// ===== 게시글 상세 + 댓글 =====
async function openPostDetail(postId) {
  const box = openModal(h('div', { class: 'loading' }, '불러오는 중…'), { wide: true, onClose: () => detailDirty && route() });
  let detailDirty = false;

  const [{ data: post, error }, { data: comments, error: cErr }] = await Promise.all([
    sb.from('posts').select(POST_SELECT).eq('id', postId).maybeSingle(),
    sb.from('comments').select('id, post_id, user_id, content, created_at, updated_at, author:profiles!comments_user_id_fkey(nickname), comment_likes(count)').eq('post_id', postId).order('created_at').order('id'),
  ]);
  if (error || cErr) return fail(error || cErr, '게시물을 불러오지 못했습니다.');
  if (!post) {
    closeModal();
    return toast('삭제된 게시물입니다');
  }
  const [likedPosts, likedComments] = await Promise.all([myLikedPostIds([post.id]), myLikedCommentIds(comments.map((c) => c.id))]);

  const url = imageUrl(post.image_path);
  const lk = likeButton({ liked: likedPosts.has(post.id), count: countOf(post.post_likes), like: () => likePost(post.id), unlike: () => unlikePost(post.id), onChange: () => (detailDirty = true) });
  const list = h('ul', { class: 'comments' });

  const captionItem = h(
    'li',
    { class: 'comment caption' },
    avatar(post.user_id, post.author?.nickname, 32),
    h('div', { class: 'comment-main' },
      h('p', {}, h('a', { class: 'caption-author', href: `#/profile/${post.user_id}`, onClick: closeModal }, post.author?.nickname || ''), ' ', post.content),
      h('div', { class: 'comment-meta muted' }, timeAgo(post.created_at), isEdited(post) ? ' · 수정됨' : ''),
    ),
  );
  list.append(captionItem);
  for (const c of comments) list.append(commentItem(c, likedComments.has(c.id)));

  function commentItem(c, liked) {
    const mine = state.user && c.user_id === state.user.id;
    const text = h('span', { class: 'comment-text' }, c.content);
    const meta = h('div', { class: 'comment-meta muted' }, timeAgo(c.created_at), isEdited(c) ? ' · 수정됨' : '');
    const clk = likeButton({
      liked,
      count: countOf(c.comment_likes),
      like: () => likeComment(c.id),
      unlike: () => unlikeComment(c.id),
      small: true,
      onChange: (s) => (c.comment_likes = [{ count: s.count }]),
    });
    const li = h(
      'li',
      { class: 'comment' },
      avatar(c.user_id, c.author?.nickname, 32),
      h('div', { class: 'comment-main' }, h('p', {}, h('a', { class: 'caption-author', href: `#/profile/${c.user_id}`, onClick: closeModal }, c.author?.nickname || ''), ' ', text), meta),
      h('div', { class: 'comment-like' }, clk.btn),
    );
    meta.append(clk.num);
    if (mine) {
      meta.append(
        h('button', { class: 'link-btn', onClick: () => editComment() }, '수정'),
        h('button', { class: 'link-btn danger', onClick: () => removeComment() }, '삭제'),
      );
    }

    function editComment() {
      const input = h('textarea', { class: 'inline-edit', maxlength: 500, rows: 2 });
      input.value = c.content;
      const save = h('button', { class: 'btn btn-primary btn-sm' }, '저장');
      const cancel = h('button', { class: 'btn btn-ghost btn-sm' }, '취소');
      const editor = h('div', { class: 'inline-editor' }, input, h('div', { class: 'row' }, cancel, save));
      const p = text.parentElement;
      p.replaceWith(editor);
      meta.hidden = true;
      input.focus();
      cancel.onclick = () => (editor.replaceWith(p), (meta.hidden = false));
      save.onclick = async () => {
        const content = input.value.trim();
        if (!content) return toast('내용을 입력해 주세요');
        save.disabled = true;
        const { data, error } = await sb.from('comments').update({ content }).eq('id', c.id).select('content, created_at, updated_at').maybeSingle();
        save.disabled = false;
        if (error) return fail(error, '댓글을 수정하지 못했습니다.');
        if (!data) return toast('내 댓글만 수정할 수 있어요');
        Object.assign(c, data);
        li.replaceWith(commentItem(c, clk.btn.classList.contains('liked')));
      };
    }

    async function removeComment() {
      if (!confirm('댓글을 삭제할까요?')) return;
      const { data, error } = await sb.from('comments').delete().eq('id', c.id).select('id');
      if (error) return fail(error, '댓글을 삭제하지 못했습니다.');
      if (!data.length) return toast('내 댓글만 삭제할 수 있어요');
      li.remove();
      detailDirty = true;
    }
    return li;
  }

  let commentForm;
  if (state.user) {
    const input = h('input', { placeholder: '댓글 달기…', maxlength: 500, 'aria-label': '댓글' });
    const send = h('button', { class: 'link-btn primary', type: 'submit', disabled: true }, '게시');
    input.addEventListener('input', () => (send.disabled = !input.value.trim()));
    commentForm = h('form', { class: 'comment-form', onSubmit: async (e) => {
      e.preventDefault();
      const content = input.value.trim();
      if (!content) return;
      send.disabled = true;
      const { data, error } = await sb.from('comments').insert({ post_id: post.id, content }).select('id, post_id, user_id, content, created_at, updated_at, author:profiles!comments_user_id_fkey(nickname), comment_likes(count)').single();
      if (error) {
        send.disabled = false;
        return fail(error, '댓글을 달지 못했습니다.');
      }
      input.value = '';
      list.append(commentItem(data, false));
      list.scrollTop = list.scrollHeight;
      detailDirty = true;
    } }, input, send);
  } else {
    commentForm = h('div', { class: 'comment-form muted' }, h('a', { href: '#/login', onClick: closeModal }, '로그인'), '하고 댓글을 남겨 보세요.');
  }

  const media = url
    ? h('div', { class: 'detail-media' }, h('img', { src: url, alt: '' }), h('span', { class: 'big-heart', html: ICON.heartFill }))
    : h('div', { class: 'detail-media text' }, h('p', {}, post.content));
  media.addEventListener('dblclick', () => {
    const heart = media.querySelector('.big-heart');
    if (heart) {
      heart.classList.remove('show');
      void heart.offsetWidth;
      heart.classList.add('show');
    }
    lk.likeOnly();
  });

  box.replaceChildren(
    h('div', { class: 'detail' },
      media,
      h('div', { class: 'detail-side' },
        h('header', { class: 'post-head' }, authorLink(post.user_id, post.author?.nickname), h('span', { class: 'spacer' }), postMenu(post)),
        list,
        h('div', { class: 'detail-actions' }, h('div', { class: 'post-actions' }, lk.btn), h('div', { class: 'post-body' }, lk.num), h('div', { class: 'muted small' }, timeAgo(post.created_at))),
        commentForm,
      ),
    ),
  );
}

// ===== 프로필 =====
async function renderProfile(userId) {
  $app.replaceChildren(h('div', { class: 'loading' }, '불러오는 중…'));
  const [{ data: profile, error }, { data: posts, count, error: pErr }] = await Promise.all([
    sb.from('profiles').select('id, nickname, created_at').eq('id', userId).maybeSingle(),
    sb.from('posts').select('id, content, image_path, post_likes(count), comments(count)', { count: 'exact' }).eq('user_id', userId).order('created_at', { ascending: false }).order('id', { ascending: false }),
  ]);
  if (error || pErr) return fail(error || pErr, '프로필을 불러오지 못했습니다.');
  if (!profile) {
    $app.replaceChildren(h('div', { class: 'empty card' }, h('p', {}, '존재하지 않는 사용자입니다.')));
    return;
  }
  const mine = state.user?.id === profile.id;
  const nameEl = h('h1', { class: 'profile-name' }, profile.nickname);

  const grid = h('div', { class: 'grid' });
  for (const p of posts) {
    const url = imageUrl(p.image_path);
    grid.append(
      h('button', { class: `tile${url ? '' : ' tile-text'}`, onClick: () => openPostDetail(p.id) },
        url ? h('img', { src: url, alt: '', loading: 'lazy' }) : h('p', {}, p.content),
        h('span', { class: 'tile-hover' }, h('span', { html: ICON.heartFill }), countOf(p.post_likes), h('span', { html: ICON.comment }), countOf(p.comments)),
      ),
    );
  }

  $app.replaceChildren(
    h('section', { class: 'profile' },
      h('div', { class: 'profile-head' },
        avatar(profile.id, profile.nickname, 96),
        h('div', { class: 'profile-info' },
          h('div', { class: 'row' }, nameEl, mine ? h('button', { class: 'btn btn-ghost btn-sm', onClick: () => editNickname(profile) }, '프로필 편집') : null),
          h('p', { class: 'profile-stats' }, '게시물 ', h('strong', {}, String(count ?? posts.length))),
          h('p', { class: 'muted small' }, `${new Date(profile.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' })} 가입`),
        ),
      ),
      posts.length ? grid : h('div', { class: 'empty' }, h('p', {}, mine ? '첫 게시물을 올려 보세요.' : '아직 게시물이 없어요.'), mine ? h('button', { class: 'btn btn-primary', onClick: () => openComposer() }, '새 게시물') : null),
    ),
  );
}

function editNickname(profile) {
  const input = h('input', { maxlength: 20, required: true, 'aria-label': '닉네임' });
  input.value = profile.nickname;
  const err = h('p', { class: 'form-error' });
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, '저장');
  openModal(
    h('form', { class: 'small-form', onSubmit: async (e) => {
      e.preventDefault();
      const nickname = input.value.trim();
      if (nickname.length < 2 || nickname.length > 20) return (err.textContent = '닉네임은 2~20자로 입력해 주세요.');
      if (nickname === profile.nickname) return closeModal();
      save.disabled = true;
      const { data, error } = await sb.from('profiles').update({ nickname }).eq('id', state.user.id).select('nickname').maybeSingle();
      save.disabled = false;
      if (error) return (err.textContent = error.code === '23505' ? '이미 사용 중인 닉네임입니다.' : '저장하지 못했습니다.');
      if (!data) return (err.textContent = '내 프로필만 수정할 수 있어요.');
      state.me.nickname = data.nickname;
      closeModal();
      renderNav();
      toast('닉네임을 바꿨습니다');
      route();
    } },
      h('h3', {}, '프로필 편집'),
      h('label', { class: 'field' }, h('span', {}, '닉네임'), input),
      err,
      h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn btn-ghost', onClick: closeModal }, '취소'), save),
    ),
  );
  input.focus();
}

// ===== 라우터 =====
function route() {
  closeActionSheet();
  const hash = location.hash || '#/';
  window.scrollTo(0, 0);
  if (hash === '#/login') return renderLogin();
  const m = hash.match(/^#\/profile\/([0-9a-f-]{36})$/i);
  if (m) return renderProfile(m[1]);
  return renderFeed();
}

window.addEventListener('hashchange', () => {
  closeModal();
  route();
});

// ===== 시작 =====
async function applySession(session) {
  state.user = session?.user ?? null;
  await loadMe();
  renderNav();
}

const { data: { session } } = await sb.auth.getSession();
await applySession(session);
route();

let lastUserId = state.user?.id ?? null;
sb.auth.onAuthStateChange((_event, session) => {
  // 콜백 안에서 바로 Supabase 호출을 await 하지 않도록 다음 틱으로 미룬다
  setTimeout(async () => {
    const uid = session?.user?.id ?? null;
    if (uid === lastUserId) {
      state.user = session?.user ?? null;
      return;
    }
    lastUserId = uid;
    await applySession(session);
    route();
  }, 0);
});
