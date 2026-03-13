/* 广西桂果新酿食品有限公司邮件系统（训练用）
 * - 纯前端、本地存储 LocalStorage
 * - 不对接真实 SMTP/外部邮箱
 * 注意：训练用演示，密码明文存储，勿用于生产。
 */

(() => {
  "use strict";

  // 变更演示数据后升级 Key，以清理旧训练数据
  const STORAGE_KEY = "mail_sim_v2_order_only";
  const PAGE_SIZE = 10;

  // 收件箱点击计数器
  let inboxClickCount = 0;

  // 有些浏览器在 file:// 下会禁用 localStorage，导致页面直接白屏
  // 这里做降级：不可用时用内存存储（刷新会丢失，但可正常训练演示）
  const storage = (() => {
    try {
      const ls = window.localStorage;
      const testKey = "__mail_sim_test__";
      ls.setItem(testKey, "1");
      ls.removeItem(testKey);
      return ls;
    } catch {
      const mem = new Map();
      return {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => mem.set(k, String(v)),
        removeItem: (k) => mem.delete(k),
        _type: "memory",
      };
    }
  })();

  // ---------- utils ----------
  const nowIso = () => new Date().toISOString();
  const fmtDateTime = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  };
  const uid = () =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const esc = (s) =>
    String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  function getAppEl() {
    const el = document.getElementById("app");
    if (!el) throw new Error("找不到 #app 容器");
    return el;
  }

  function toast(app, type, msg) {
    app._flash = { type, msg, at: Date.now() };
  }

  // ---------- storage ----------
  function loadState() {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveState(state) {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function msgFromLabel(state, msg) {
    return (
      String(msg?.fromName || "").trim() ||
      getUserById(state, msg?.fromUserId)?.username ||
      "unknown"
    );
  }

  function msgToLabel(state, msg) {
    return (
      String(msg?.toName || "").trim() ||
      getUserById(state, msg?.toUserId)?.username ||
      "unknown"
    );
  }

  function seedState() {
    // 训练用：只保留“一封订单邮件”，其余收信内容全部删除
    const alice = { id: uid(), username: "alice", password: "123456" };
    // 外部客户发件人（模拟）
    const customer = { id: uid(), username: "customer", password: "123456" };

    const messages = [];
    const mailItems = [];

    const sentAt = new Date(Date.now() - 1000 * 60 * 25).toISOString();
    const messageId = uid();
    messages.push({
      id: messageId,
      fromUserId: customer.id,
      toUserId: alice.id,
      fromName: "广西田阳县亿农芒果专业合作社",
      toName: "果酱生产部（alice）",
      subject: "订单邮件：5000斤芒果——请3天内完成果酱生产并发货",
      body:
        "您好：\n\n我方“广西田阳县亿农芒果专业合作社”现下达芒果订单如下：\n\n- 品名：芒果（鲜果）\n- 数量：5000斤\n- 要求：请在3天内完成果酱生产，并安排发货\n\n请收到后尽快确认生产排期与发货时间，并回复本邮件。\n\n此致\n广西田阳县亿农芒果专业合作社",
      sentAt,
    });

    // 收件人一份（收件箱）
    mailItems.push({
      id: uid(),
      ownerUserId: alice.id,
      messageId,
      folder: "inbox",
      isRead: false,
      createdAt: sentAt,
    });

    // 发件人一份（已发送）——用于系统内部留档（可不登录查看）
    mailItems.push({
      id: uid(),
      ownerUserId: customer.id,
      messageId,
      folder: "sent",
      isRead: true,
      createdAt: sentAt,
    });

    return {
      version: 2,
      createdAt: nowIso(),
      users: [alice, customer],
      messages,
      mailItems,
      session: {
        currentUserId: null,
      },
    };
  }

  function ensureState() {
    let state = loadState();
    if (!state || !state.users || !state.mailItems || !state.messages) {
      state = seedState();
      saveState(state);
    }
    return state;
  }

  // ---------- domain ----------
  function getUserById(state, id) {
    return state.users.find((u) => u.id === id) || null;
  }
  function getUserByUsername(state, username) {
    const key = String(username || "").trim().toLowerCase();
    return state.users.find((u) => u.username.toLowerCase() === key) || null;
  }
  function requireAuthed(state) {
    const u = getUserById(state, state.session.currentUserId);
    return u;
  }

  function countsForUser(state, userId) {
    const items = state.mailItems.filter((m) => m.ownerUserId === userId);
    const byFolder = (folder) => items.filter((m) => m.folder === folder);
    const unread = (folder) => byFolder(folder).filter((m) => !m.isRead).length;
    return {
      inbox: byFolder("inbox").length,
      sent: byFolder("sent").length,
      trash: byFolder("trash").length,
      inboxUnread: unread("inbox"),
    };
  }

  function listMail(state, { userId, folder, q, page }) {
    const query = String(q || "").trim().toLowerCase();
    let items = state.mailItems.filter(
      (m) => m.ownerUserId === userId && m.folder === folder
    );

    items = items
      .map((it) => ({
        ...it,
        msg: state.messages.find((x) => x.id === it.messageId) || null,
      }))
      .filter((it) => it.msg);

    if (query) {
      items = items.filter((it) => {
        const from = msgFromLabel(state, it.msg);
        const to = msgToLabel(state, it.msg);
        const hay = `${it.msg.subject}\n${it.msg.body}\n${from}\n${to}`.toLowerCase();
        return hay.includes(query);
      });
    }

    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
    const start = (safePage - 1) * PAGE_SIZE;
    const slice = items.slice(start, start + PAGE_SIZE);
    return { total, totalPages, page: safePage, items: slice };
  }

  function getMailItem(state, { userId, mailItemId }) {
    const it = state.mailItems.find(
      (m) => m.id === mailItemId && m.ownerUserId === userId
    );
    if (!it) return null;
    const msg = state.messages.find((x) => x.id === it.messageId);
    if (!msg) return null;
    return { ...it, msg };
  }

  function markRead(state, { userId, mailItemId, isRead = true }) {
    const it = state.mailItems.find(
      (m) => m.id === mailItemId && m.ownerUserId === userId
    );
    if (!it) return false;
    it.isRead = !!isRead;
    saveState(state);
    return true;
  }

  function moveToTrash(state, { userId, mailItemId }) {
    const it = state.mailItems.find(
      (m) => m.id === mailItemId && m.ownerUserId === userId
    );
    if (!it) return false;
    it.folder = "trash";
    saveState(state);
    return true;
  }

  function restoreFromTrash(state, { userId, mailItemId }) {
    const it = state.mailItems.find(
      (m) => m.id === mailItemId && m.ownerUserId === userId
    );
    if (!it) return false;
    if (it.folder !== "trash") return false;
    // 恢复逻辑：如果是收件人视角 => inbox；发件人视角 => sent
    const msg = state.messages.find((x) => x.id === it.messageId);
    if (!msg) return false;
    it.folder = msg.fromUserId === userId ? "sent" : "inbox";
    saveState(state);
    return true;
  }

  function hardDelete(state, { userId, mailItemId }) {
    const idx = state.mailItems.findIndex(
      (m) => m.id === mailItemId && m.ownerUserId === userId
    );
    if (idx === -1) return false;
    if (state.mailItems[idx].folder !== "trash") return false;
    state.mailItems.splice(idx, 1);
    saveState(state);
    return true;
  }

  function deliverMessage(
    state,
    {
      fromUserId,
      toUserId,
      fromName,
      toName,
      subject,
      body,
      sentAt = nowIso(),
      markReadForTo = false,
    }
  ) {
    const messageId = uid();
    state.messages.push({
      id: messageId,
      fromUserId,
      toUserId,
      fromName: String(fromName || "").trim(),
      toName: String(toName || "").trim(),
      subject: String(subject || "").trim() || "（无主题）",
      body: String(body || "").trim(),
      sentAt,
    });

    // 收件人一份
    state.mailItems.push({
      id: uid(),
      ownerUserId: toUserId,
      messageId,
      folder: "inbox",
      isRead: !!markReadForTo,
      createdAt: sentAt,
    });

    // 发件人一份
    state.mailItems.push({
      id: uid(),
      ownerUserId: fromUserId,
      messageId,
      folder: "sent",
      isRead: true,
      createdAt: sentAt,
    });

    return messageId;
  }

  function sendMail(state, { fromUserId, toUsername, subject, body }) {
    const from = getUserById(state, fromUserId);
    if (!from) throw new Error("未登录");
    const to = getUserByUsername(state, toUsername);
    if (!to) throw new Error("收件人不存在（按用户名）");
    if (to.id === from.id) throw new Error("不支持给自己发信（训练规则）");

    deliverMessage(state, {
      fromUserId: from.id,
      toUserId: to.id,
      fromName: from.username,
      toName: to.username,
      subject,
      body,
      sentAt: nowIso(),
      markReadForTo: false,
    });

    saveState(state);
    return true;
  }

  function login(state, { username, password }) {
    const u = getUserByUsername(state, username);
    if (!u) throw new Error("账号不存在");
    if (u.password !== String(password || "")) throw new Error("密码错误");
    state.session.currentUserId = u.id;
    saveState(state);
    return u;
  }

  function logout(state) {
    state.session.currentUserId = null;
    saveState(state);
  }

  function register(state, { username, password }) {
    const name = String(username || "").trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{2,15}$/.test(name)) {
      throw new Error("用户名需为 3-16 位：字母开头，仅字母/数字/下划线");
    }
    if (getUserByUsername(state, name)) throw new Error("用户名已存在");
    const pwd = String(password || "");
    if (pwd.length < 4) throw new Error("密码至少 4 位（训练用）");
    const u = { id: uid(), username: name, password: pwd };
    state.users.push(u);
    state.session.currentUserId = u.id;
    saveState(state);
    return u;
  }

  // ---------- router ----------
  function parseHash() {
    const raw = location.hash.replace(/^#/, "");
    const [pathPart, qs] = raw.split("?");
    const path = (pathPart || "").trim() || "/mail/inbox";
    const params = new URLSearchParams(qs || "");
    const get = (k, fallback = "") => params.get(k) ?? fallback;
    return { path, params, get };
  }

  function goto(path, params = {}) {
    const usp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      const s = String(v);
      if (s === "") return;
      usp.set(k, s);
    });
    const qs = usp.toString();
    location.hash = `#${path}${qs ? `?${qs}` : ""}`;
  }

  // ---------- views ----------
  function render(app) {
    const state = ensureState();
    const me = requireAuthed(state);
    const { path, get } = parseHash();

    // 登录页无需登录
    if (!me && !path.startsWith("/auth")) {
      goto("/auth/login");
      return;
    }
    if (me && path.startsWith("/auth")) {
      goto("/mail/inbox");
      return;
    }

    app.innerHTML = me ? renderShell(state, me) : renderAuth(state);
    bindOnce(app);

    if (!me) return;
    renderMailArea(app, state, me);
  }

  function flashHtml(app) {
    const f = app._flash;
    if (!f) return "";
    // 清一次就好
    app._flash = null;
    const cls = f.type === "ok" ? "ok" : "err";
    return `<div class="${cls}">${esc(f.msg)}</div>`;
  }

  function renderAuth(state) {
    const { path } = parseHash();
    const mode = path.includes("register") ? "register" : "login";
    return `
      <div class="shell">
        <div class="topbar">
          <div class="brand"><span class="dot"></span>广西桂果新酿食品有限公司邮件系统</div>
          <div class="right">
            <span class="pill">LocalStorage</span>
          </div>
        </div>

        <div class="auth">
          <div class="panel hero">
            <h1>广西桂果新酿食品有限公司邮件系统</h1>
            <div class="tips">
              <div><b>演示账号</b>：alice（密码 123456）</div>
              <div></div>
              <div><b>提示</b>：登录页可一键重置种子数据，方便反复训练。</div>
              <div style="margin-top:8px; opacity:.9;">用户名规则：3-16 位，字母开头，仅字母/数字/下划线</div>
            </div>
          </div>

          <div class="panel">
            <div class="hd">
              <h2>${mode === "login" ? "登录" : "注册"}</h2>
              <div class="stack">
                <button class="btn small ghost" data-action="nav-auth" data-to="${
                  mode === "login" ? "register" : "login"
                }">${mode === "login" ? "去注册" : "去登录"}</button>
              </div>
            </div>
            <div class="bd">
              ${flashHtml(getAppEl())}
              <form class="form" data-role="auth-form" data-mode="${mode}">
                <div class="field">
                  <label>用户名</label>
                  <input name="username" autocomplete="username" placeholder="例如 alice" required />
                </div>
                <div class="field">
                  <label>密码</label>
                  <input name="password" type="password" autocomplete="current-password" placeholder="例如 123456" required />
                </div>
                <div class="footer-actions">
                  <button class="btn primary" type="submit">${
                    mode === "login" ? "登录" : "注册并登录"
                  }</button>
                  <button class="btn danger" type="button" data-action="reset-seed">重置为演示数据</button>
                </div>
                <div class="hint">
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderShell(state, me) {
    const c = countsForUser(state, me.id);
    const html = `
      <div class="shell">
        <div class="topbar">
          <div class="brand"><span class="dot"></span>广西桂果新酿食品有限公司邮件系统</div>
          <div class="right">
            <span>当前用户</span>
            <span class="pill">${esc(me.username)}</span>
            <button class="btn small" data-action="logout">退出</button>
          </div>
        </div>

        <div class="content">
          <div class="panel">
            <div class="hd">
              <h2>邮箱</h2>
              <button class="btn small primary" data-action="compose">写信</button>
            </div>
            <div class="bd">
              <div class="menu" data-role="folder-menu">
                <a href="#/mail/inbox" data-folder="inbox" data-action="click-folder">
                  <span>收件箱</span>
                  <span class="badge ${c.inboxUnread ? "unread" : ""}">${c.inboxUnread}</span>
                </a>
                <a href="#/mail/sent" data-folder="sent">
                  <span>已发送</span>
                  <span class="badge">${c.sent}</span>
                </a>
                <a href="#/mail/trash" data-folder="trash">
                  <span>垃圾箱</span>
                  <span class="badge">${c.trash}</span>
                </a>
              </div>
              <div style="margin-top:12px;">
                <button class="btn danger small" data-action="reset-seed">重置为演示数据</button>
              </div>
              <div style="margin-top:8px;">
                <button class="btn small" data-action="test-trigger">模拟紧急通知</button>
              </div>
            <div class="hint" style="margin-top:10px;">
                训练规则：按用户名投递（例如 to=customer）
              </div>
            </div>
          </div>

          <div class="panel" id="panel-list">
            <div class="hd">
              <h2 id="list-title">列表</h2>
            </div>
            <div class="bd" id="list-body"></div>
          </div>

          <div class="panel" id="panel-detail">
            <div class="hd">
              <h2 id="detail-title">详情</h2>
              <div class="stack" id="detail-actions"></div>
            </div>
            <div class="bd" id="detail-body"></div>
          </div>
        </div>
      </div>
    `;
    console.log("renderShell HTML generated");
    return html;
  }

  function renderMailArea(app, state, me) {
    const { path, get } = parseHash();

    const listTitleEl = app.querySelector("#list-title");
    const listBodyEl = app.querySelector("#list-body");
    const detailTitleEl = app.querySelector("#detail-title");
    const detailActionsEl = app.querySelector("#detail-actions");
    const detailBodyEl = app.querySelector("#detail-body");
    if (!listTitleEl || !listBodyEl || !detailTitleEl || !detailActionsEl || !detailBodyEl)
      return;

    // folder highlight
    const folder =
      path.startsWith("/mail/") ? path.replace("/mail/", "").split("/")[0] : "inbox";
    const menu = app.querySelector('[data-role="folder-menu"]');
    if (menu) {
      menu.querySelectorAll("a").forEach((a) => a.classList.remove("active"));
      const active = menu.querySelector(`a[data-folder="${folder}"]`);
      if (active) active.classList.add("active");
    }

    // compose view
    if (path.startsWith("/compose")) {
      listTitleEl.textContent = "写信";
      listBodyEl.innerHTML = renderCompose(me);
      detailTitleEl.textContent = "提示";
      detailActionsEl.innerHTML = "";
      detailBodyEl.innerHTML = `<div class="empty">写信后点击“发送”，系统会将邮件投递到对方收件箱，并在你的“已发送”中保留一份。</div>`;
      return;
    }

    // list view
    const q = get("q", "");
    const page = Number(get("p", "1")) || 1;
    const selected = get("id", "");

    // 如果在收件箱打开未读邮件：先标记已读，再重渲染一次以刷新未读角标与列表样式
    if (selected) {
      const it0 = getMailItem(state, { userId: me.id, mailItemId: selected });
      if (it0 && it0.folder === "inbox" && !it0.isRead) {
        markRead(state, { userId: me.id, mailItemId: it0.id, isRead: true });
        render(app);
        return;
      }
    }

    const titleMap = { inbox: "收件箱", sent: "已发送", trash: "垃圾箱" };
    listTitleEl.textContent = titleMap[folder] || "列表";

    const result = listMail(state, { userId: me.id, folder, q, page });
    listBodyEl.innerHTML = renderList(state, me, folder, result, q);

    // detail view
    if (!selected) {
      detailTitleEl.textContent = "详情";
      detailActionsEl.innerHTML = "";
      detailBodyEl.innerHTML = `<div class="empty">从左侧列表选择一封邮件查看详情。</div>`;
      return;
    }

    const it = getMailItem(state, { userId: me.id, mailItemId: selected });
    if (!it) {
      detailTitleEl.textContent = "详情";
      detailActionsEl.innerHTML = "";
      detailBodyEl.innerHTML = `<div class="empty">邮件不存在或已被删除。</div>`;
      return;
    }

    const fromName = msgFromLabel(state, it.msg);
    const toName = msgToLabel(state, it.msg);

    detailTitleEl.textContent = it.msg.subject || "（无主题）";
    detailActionsEl.innerHTML = renderDetailActions(folder, it.id);
    detailBodyEl.innerHTML = renderDetail(state, it, { fromName, toName });
  }

  function renderCompose(me) {
    return `
      <div class="detail">
        <div class="meta">
          <div class="hint">发件人：<span class="pill">${esc(me.username)}</span></div>
        </div>
        <form class="form" data-role="compose-form">
          <div class="field">
            <label>联系人</label>
            <div class="stack">
              <button
                class="btn small"
                type="button"
                data-action="fill-contact"
                data-to="customer"
                data-label="广西田阳县亿农芒果专业合作社"
              >广西田阳县亿农芒果专业合作社</button>
            </div>
            <div class="hint" style="margin-top:6px;">点击联系人会自动填入“收件人（用户名）”。</div>
          </div>
          <div class="field">
            <label>收件人（用户名）</label>
            <input name="to" list="contact-list" placeholder="例如 customer" required />
            <datalist id="contact-list">
              <option value="customer">广西田阳县亿农芒果专业合作社</option>
            </datalist>
          </div>
          <div class="field">
            <label>主题</label>
            <input name="subject" placeholder="（可选）" />
          </div>
          <div class="field">
            <label>正文</label>
            <textarea name="body" placeholder="请输入正文..."></textarea>
          </div>
          <div class="row">
            <button class="btn primary" type="submit">发送</button>
            <button class="btn" type="button" data-action="nav-mail" data-folder="inbox">返回收件箱</button>
          </div>
        </form>
      </div>
    `;
  }

  function renderList(state, me, folder, result, q) {
    const { items, total, totalPages, page } = result;
    const selected = parseHash().get("id", "");
    const title = folder === "inbox" ? "收件箱" : folder === "sent" ? "已发送" : "垃圾箱";
    return `
      <div>
        <input class="search" placeholder="搜索：主题 / 正文 / 发件人 / 收件人" value="${esc(
          q
        )}" data-role="search" />

        <div class="hint" style="margin-top:10px;">
          ${title}：共 <span class="pill">${total}</span> 封邮件
        </div>

        <div class="list" style="margin-top:10px;">
          ${
            items.length
              ? items
                  .map((it) => {
                    const msg = it.msg;
                    const from = msgFromLabel(state, msg);
                    const to = msgToLabel(state, msg);
                    const who = folder === "sent" ? `To: ${to}` : `From: ${from}`;
                    const snip = String(msg.body || "").trim().slice(0, 90);
                    const active = it.id === selected ? "active" : "";
                    const unread = !it.isRead && folder === "inbox" ? "unread" : "";
                    const href = `#/mail/${folder}?p=${page}&q=${encodeURIComponent(
                      q || ""
                    )}&id=${encodeURIComponent(it.id)}`;
                    return `
                      <div class="item ${active} ${unread}" data-action="open-mail" data-id="${esc(
                        it.id
                      )}" data-href="${esc(href)}">
                        <div class="top">
                          <div class="from">${esc(who)}</div>
                          <div class="date">${esc(fmtDateTime(it.createdAt))}</div>
                        </div>
                        <div class="subj">${esc(msg.subject || "（无主题）")}</div>
                        <div class="snip">${esc(snip || "（无正文）")}</div>
                      </div>
                    `;
                  })
                  .join("")
              : `<div class="empty">暂无邮件。</div>`
          }
        </div>

        <div class="pager">
          <div class="mono">第 ${page} / ${totalPages} 页</div>
          <div class="row">
            <button class="btn small" data-action="page-prev" ${
              page <= 1 ? "disabled" : ""
            }>上一页</button>
            <button class="btn small" data-action="page-next" ${
              page >= totalPages ? "disabled" : ""
            }>下一页</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderDetailActions(folder, mailItemId) {
    if (folder === "trash") {
      return `
        <button class="btn small" data-action="restore" data-id="${esc(mailItemId)}">恢复</button>
        <button class="btn small danger" data-action="hard-delete" data-id="${esc(
          mailItemId
        )}">彻底删除</button>
      `;
    }
    return `
      <button class="btn small danger" data-action="trash" data-id="${esc(
        mailItemId
      )}">删除到垃圾箱</button>
    `;
  }

  function renderDetail(state, it, { fromName, toName }) {
    return `
      <div class="detail">
        <div class="meta">
          <div class="kv">
            <div class="k">From</div><div class="v"><span class="pill">${esc(fromName)}</span></div>
            <div class="k">To</div><div class="v"><span class="pill">${esc(toName)}</span></div>
            <div class="k">Time</div><div class="v">${esc(fmtDateTime(it.msg.sentAt))}</div>
          </div>
        </div>
        <div class="body">${esc(it.msg.body || "（无正文）")}</div>
      </div>
    `;
  }

  // ---------- events ----------
  function bindOnce(app) {
    if (app._bound) return;
    app._bound = true;

    window.addEventListener("hashchange", () => {
      const { path } = parseHash();
      if (path === "/mail/inbox") {
        inboxClickCount++;
        if (inboxClickCount === 4) {
          const state = ensureState();
          const customer = getUserByUsername(state, "customer");
          const alice = getUserByUsername(state, "alice");
          if (customer && alice) {
            deliverMessage(state, {
              fromUserId: customer.id,
              toUserId: alice.id,
              fromName: "广西田阳县亿农芒果专业合作社",
              toName: "果酱生产部（alice）",
              subject: "突发！合作社要求提前1天交货，否则订单取消！",
              body: "您好：\n\n紧急通知！\n\n由于我方合作社临时调整生产计划，现要求将原定3天内完成的果酱生产交货时间提前1天，即请在2天内完成生产并安排发货。\n\n如无法满足此要求，我方将不得不取消该订单。\n\n请尽快回复确认是否能够按时完成。\n\n此致\n广西田阳县亿农芒果专业合作社",
              sentAt: nowIso(),
              markReadForTo: false,
            });
            saveState(state);
            const appEl = getAppEl();
            toast(appEl, "ok", "收到紧急邮件！");
          }
        }
      }
      render(app);
    });

    document.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const btn = t.closest("[data-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      if (!action) return;
      
      console.log("Click event captured, action:", action);

      const state = ensureState();
      const me = requireAuthed(state);
      const { path, get } = parseHash();
      
      console.log("me:", me, "path:", path);

      try {
        if (action === "nav-auth") {
          e.preventDefault();
          const to = btn.getAttribute("data-to") === "register" ? "register" : "login";
          goto(`/auth/${to}`);
          return;
        }

        if (action === "reset-seed") {
          storage.removeItem(STORAGE_KEY);
          toast(app, "ok", "已重置为演示数据");
          render(app);
          return;
        }

        if (action === "test-trigger") {
          const customer = getUserByUsername(state, "customer");
          const alice = getUserByUsername(state, "alice");
          console.log("test-trigger: customer:", customer, "alice:", alice);
          if (customer && alice) {
            deliverMessage(state, {
              fromUserId: customer.id,
              toUserId: alice.id,
              fromName: "广西田阳县亿农芒果专业合作社",
              toName: "果酱生产部（alice）",
              subject: "突发！合作社要求提前1天交货，否则订单取消！",
              body: "您好：\n\n紧急通知！\n\n由于我方合作社临时调整生产计划，现要求将原定3天内完成的果酱生产交货时间提前1天，即请在2天内完成生产并安排发货。\n\n如无法满足此要求，我方将不得不取消该订单。\n\n请尽快回复确认是否能够按时完成。\n\n此致\n广西田阳县亿农芒果专业合作社",
              sentAt: nowIso(),
              markReadForTo: false,
            });
            saveState(state);
            toast(app, "ok", "收到紧急邮件！");
            console.log("Emergency email sent via test-trigger!");
            render(app);
          }
          return;
        }

        if (action === "logout") {
          logout(state);
          toast(app, "ok", "已退出登录");
          goto("/auth/login");
          return;
        }

        if (!me) return;

        if (action === "compose") {
          goto("/compose/new");
          return;
        }

        if (action === "click-folder") {
          e.preventDefault();
          const folder = btn.getAttribute("data-folder") || "inbox";
          console.log("click-folder action triggered, folder:", folder, "inboxClickCount:", inboxClickCount);
          if (folder === "inbox") {
            inboxClickCount++;
            console.log("inboxClickCount incremented to:", inboxClickCount);
            if (inboxClickCount === 4) {
              const customer = getUserByUsername(state, "customer");
              const alice = getUserByUsername(state, "alice");
              console.log("customer:", customer, "alice:", alice);
              if (customer && alice) {
                deliverMessage(state, {
                  fromUserId: customer.id,
                  toUserId: alice.id,
                  fromName: "广西田阳县亿农芒果专业合作社",
                  toName: "果酱生产部（alice）",
                  subject: "突发！合作社要求提前1天交货，否则订单取消！",
                  body: "您好：\n\n紧急通知！\n\n由于我方合作社临时调整生产计划，现要求将原定3天内完成的果酱生产交货时间提前1天，即请在2天内完成生产并安排发货。\n\n如无法满足此要求，我方将不得不取消该订单。\n\n请尽快回复确认是否能够按时完成。\n\n此致\n广西田阳县亿农芒果专业合作社",
                  sentAt: nowIso(),
                  markReadForTo: false,
                });
                saveState(state);
                toast(app, "ok", "收到紧急邮件！");
                console.log("Emergency email sent!");
              }
            }
          }
          goto(`/mail/${folder}`, { p: 1, q: "" });
          return;
        }

        if (action === "nav-mail") {
          const folder = btn.getAttribute("data-folder") || "inbox";
          if (folder === "inbox") {
            inboxClickCount++;
            if (inboxClickCount === 4) {
              const customer = getUserByUsername(state, "customer");
              const alice = getUserByUsername(state, "alice");
              if (customer && alice) {
                deliverMessage(state, {
                  fromUserId: customer.id,
                  toUserId: alice.id,
                  fromName: "广西田阳县亿农芒果专业合作社",
                  toName: "果酱生产部（alice）",
                  subject: "突发！合作社要求提前1天交货，否则订单取消！",
                  body: "您好：\n\n紧急通知！\n\n由于我方合作社临时调整生产计划，现要求将原定3天内完成的果酱生产交货时间提前1天，即请在2天内完成生产并安排发货。\n\n如无法满足此要求，我方将不得不取消该订单。\n\n请尽快回复确认是否能够按时完成。\n\n此致\n广西田阳县亿农芒果专业合作社",
                  sentAt: nowIso(),
                  markReadForTo: false,
                });
                saveState(state);
                toast(app, "ok", "收到紧急邮件！");
              }
            }
          }
          goto(`/mail/${folder}`, { p: 1, q: "" });
          return;
        }

        if (action === "fill-contact") {
          const to = btn.getAttribute("data-to") || "";
          const label = btn.getAttribute("data-label") || "";
          const form = document.querySelector('form[data-role="compose-form"]');
          if (form) {
            const toInput = form.querySelector('input[name="to"]');
            if (toInput instanceof HTMLInputElement) {
              toInput.value = to;
              toInput.focus();
            }
            const subjInput = form.querySelector('input[name="subject"]');
            if (subjInput instanceof HTMLInputElement && !subjInput.value.trim()) {
              subjInput.value = `回复：${label || to} 订单`;
            }
          }
          return;
        }

        if (action === "open-mail") {
          const href = btn.getAttribute("data-href");
          if (href) {
            location.hash = href;
            return;
          }
        }

        if (action === "trash") {
          const id = btn.getAttribute("data-id");
          if (!id) return;
          moveToTrash(state, { userId: me.id, mailItemId: id });
          toast(app, "ok", "已移入垃圾箱");
          const folder = path.startsWith("/mail/") ? path.replace("/mail/", "").split("/")[0] : "inbox";
          goto(`/mail/${folder}`, { p: get("p", "1"), q: get("q", "") });
          return;
        }

        if (action === "restore") {
          const id = btn.getAttribute("data-id");
          if (!id) return;
          restoreFromTrash(state, { userId: me.id, mailItemId: id });
          toast(app, "ok", "已恢复");
          goto("/mail/trash", { p: get("p", "1"), q: get("q", "") });
          return;
        }

        if (action === "hard-delete") {
          const id = btn.getAttribute("data-id");
          if (!id) return;
          hardDelete(state, { userId: me.id, mailItemId: id });
          toast(app, "ok", "已彻底删除");
          goto("/mail/trash", { p: get("p", "1"), q: get("q", "") });
          return;
        }

        if (action === "page-prev" || action === "page-next") {
          const folder = path.startsWith("/mail/") ? path.replace("/mail/", "").split("/")[0] : "inbox";
          const q = get("q", "");
          const current = Number(get("p", "1")) || 1;
          const delta = action === "page-prev" ? -1 : 1;
          goto(`/mail/${folder}`, { p: Math.max(1, current + delta), q });
          return;
        }
      } catch (err) {
        toast(app, "err", err?.message || "操作失败");
        render(app);
      }
    });

    document.addEventListener("submit", (e) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;

      const appEl = getAppEl();
      const state = ensureState();
      const me = requireAuthed(state);

      if (form.matches('[data-role="auth-form"]')) {
        e.preventDefault();
        const mode = form.getAttribute("data-mode") === "register" ? "register" : "login";
        const fd = new FormData(form);
        const username = String(fd.get("username") || "");
        const password = String(fd.get("password") || "");
        try {
          if (mode === "login") {
            login(state, { username, password });
            toast(appEl, "ok", "登录成功");
            goto("/mail/inbox");
          } else {
            register(state, { username, password });
            toast(appEl, "ok", "注册成功，已自动登录");
            goto("/mail/inbox");
          }
        } catch (err) {
          toast(appEl, "err", err?.message || "提交失败");
          render(appEl);
        }
        return;
      }

      if (form.matches('[data-role="compose-form"]')) {
        e.preventDefault();
        if (!me) return;
        const fd = new FormData(form);
        const to = String(fd.get("to") || "");
        const subject = String(fd.get("subject") || "");
        const body = String(fd.get("body") || "");
        try {
          sendMail(state, { fromUserId: me.id, toUsername: to, subject, body });
          toast(appEl, "ok", "发送成功");
          goto("/mail/sent", { p: 1, q: "" });

          // 训练模拟：给“广西田阳县亿农芒果专业合作社（customer）”发信后，自动触发对方回复
          const toUser = getUserByUsername(state, to);
          const customerUser = getUserByUsername(state, "customer");
          const toNorm = String(toUser?.username || "").toLowerCase();
          if (customerUser && toNorm === "customer" && me.username !== "customer") {
            const origSubj = String(subject || "").trim() || "（无主题）";
            const replySubj = /^re:/i.test(origSubj) ? origSubj : `Re: ${origSubj}`;

            window.setTimeout(() => {
              try {
                const s = ensureState();
                const customer = getUserByUsername(s, "customer");
                const sender = getUserById(s, me.id);
                if (!customer || !sender) return;

                deliverMessage(s, {
                  fromUserId: customer.id,
                  toUserId: sender.id,
                  fromName: "广西田阳县亿农芒果专业合作社",
                  toName: "广西桂果新酿食品有限公司",
                  subject: replySubj,
                  body:
                    "谢谢，麻烦你们了。\n\n我们已收到你们的邮件，会尽快配合后续安排。\n\n广西田阳县亿农芒果专业合作社",
                  sentAt: nowIso(),
                  markReadForTo: false,
                });
                saveState(s);
                toast(appEl, "ok", "收到对方回复：谢谢，麻烦你们了");
                render(appEl);
              } catch {
                // 忽略模拟回复失败
              }
            }, 1400);
          }
        } catch (err) {
          toast(appEl, "err", err?.message || "发送失败");
          render(appEl);
        }
        return;
      }
    });

    document.addEventListener("input", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      if (!t.matches('[data-role="search"]')) return;
      const { path } = parseHash();
      const folder = path.startsWith("/mail/") ? path.replace("/mail/", "").split("/")[0] : "inbox";
      const q = t.value || "";
      // 轻量 debounce：用 requestAnimationFrame 避免频繁重渲染
      cancelAnimationFrame(app._searchRaf || 0);
      app._searchRaf = requestAnimationFrame(() => {
        goto(`/mail/${folder}`, { p: 1, q });
      });
    });
  }

  // ---------- boot ----------
  const app = getAppEl();
  ensureState();
  if (!location.hash) location.hash = "#/auth/login";
  render(app);
})();

