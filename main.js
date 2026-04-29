/**
 * FitTrack Dashboard - Main JavaScript
 * Core utilities, auth, navigation, toast notifications
 */

'use strict';

// ============================================
// Constants & Config
// ============================================
const APP_NAME = 'FitTrack';
const STORAGE_KEYS = {
  USERS: 'fittrack_users',
  CURRENT_USER: 'fittrack_current_user',
  WORKOUTS: 'fittrack_workouts',
  NUTRITION: 'fittrack_nutrition',
  GOALS: 'fittrack_goals',
  BOOKINGS: 'fittrack_bookings',
  CONTACTS: 'fittrack_contacts',
  PLANNER: 'fittrack_planner',
};

// ============================================
// Storage Utility
// ============================================
const Storage = {
  get(key, fallback = null) {
    try {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.error('Storage error:', e); }
  },
  remove(key) { localStorage.removeItem(key); }
};

// ============================================
// Auth Utility
// ============================================
const Auth = {
  getUsers() { return Storage.get(STORAGE_KEYS.USERS, []); },
  getCurrentUser() { return Storage.get(STORAGE_KEYS.CURRENT_USER, null); },
  isLoggedIn() { return !!this.getCurrentUser(); },

  register(userData) {
    const users = this.getUsers();
    if (users.find(u => u.email === userData.email)) {
      return { success: false, message: 'An account with this email already exists.' };
    }
    const hashed = this._hash(userData.password);
    const newUser = {
      id: Date.now().toString(),
      name: userData.name,
      email: userData.email,
      password: hashed,
      age: userData.age || '',
      gender: userData.gender || '',
      height: userData.height || '',
      weight: userData.weight || '',
      fitnessGoal: userData.fitnessGoal || 'general',
      activityLevel: userData.activityLevel || 'moderate',
      joinedDate: new Date().toISOString(),
      avatar: userData.name.charAt(0).toUpperCase(),
    };
    users.push(newUser);
    Storage.set(STORAGE_KEYS.USERS, users);
    const { password, ...safeUser } = newUser;
    Storage.set(STORAGE_KEYS.CURRENT_USER, safeUser);
    return { success: true, user: safeUser };
  },

  login(email, password) {
    const users = this.getUsers();
    const user = users.find(u => u.email === email && u.password === this._hash(password));
    if (!user) return { success: false, message: 'Invalid email or password.' };
    const { password: _, ...safeUser } = user;
    Storage.set(STORAGE_KEYS.CURRENT_USER, safeUser);
    return { success: true, user: safeUser };
  },

  logout() {
    Storage.remove(STORAGE_KEYS.CURRENT_USER);
    window.location.href = getBasePath() + 'pages/login.html';
  },

  updateProfile(updates) {
    const current = this.getCurrentUser();
    if (!current) return false;
    const updated = { ...current, ...updates };
    Storage.set(STORAGE_KEYS.CURRENT_USER, updated);
    // Update in users array too
    const users = this.getUsers();
    const idx = users.findIndex(u => u.id === current.id);
    if (idx !== -1) {
      users[idx] = { ...users[idx], ...updates };
      Storage.set(STORAGE_KEYS.USERS, users);
    }
    return updated;
  },

  _hash(str) {
    // Simple hash for demo - in production use bcrypt
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return 'h_' + Math.abs(hash).toString(36);
  }
};

// ============================================
// Toast Notifications
// ============================================
const Toast = {
  container: null,

  init() {
    this.container = document.querySelector('.toast-container');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  },

  show(message, type = 'info', duration = 4000) {
    if (!this.container) this.init();
    const icons = { success: 'fa-check-circle', error: 'fa-times-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fas ${icons[type]}"></i><span>${message}</span>`;
    this.container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'fadeOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  success(msg, dur) { this.show(msg, 'success', dur); },
  error(msg, dur) { this.show(msg, 'error', dur); },
  warning(msg, dur) { this.show(msg, 'warning', dur); },
  info(msg, dur) { this.show(msg, 'info', dur); },
};

// ============================================
// Navigation
// ============================================
function initNavbar() {
  const navbar = document.getElementById('navbar');
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('navLinks');

  // Scroll effect
  if (navbar) {
    window.addEventListener('scroll', () => {
      navbar.classList.toggle('scrolled', window.scrollY > 50);
    });
  }

  // Mobile menu
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      hamburger.classList.toggle('open');
    });
  }

  // Update nav based on auth state
  updateNavAuth();
}

function updateNavAuth() {
  const loginBtn = document.getElementById('loginBtn');
  if (!loginBtn) return;
  if (Auth.isLoggedIn()) {
    loginBtn.textContent = 'Dashboard';
    loginBtn.href = getBasePath() + 'pages/dashboard.html';
  }
}

// ============================================
// Sidebar (Dashboard pages)
// ============================================
function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const menuToggle = document.getElementById('menuToggle');
  const overlay = document.getElementById('sidebarOverlay');

  if (!sidebar) return;

  if (menuToggle) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay?.classList.toggle('show');
    });
  }

  if (overlay) {
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
    });
  }

  // Highlight active link
  const currentPage = window.location.pathname.split('/').pop();
  document.querySelectorAll('.sidebar-link').forEach(link => {
    const href = link.getAttribute('href');
    if (href && href.includes(currentPage)) {
      link.classList.add('active');
    }
  });

  // Render user info
  const user = Auth.getCurrentUser();
  if (user) {
    const nameEl = document.getElementById('sidebarUserName');
    const emailEl = document.getElementById('sidebarUserEmail');
    const avatarEl = document.getElementById('sidebarUserAvatar');
    if (nameEl) nameEl.textContent = user.name;
    if (emailEl) emailEl.textContent = user.email;
    if (avatarEl) avatarEl.textContent = user.avatar || user.name.charAt(0).toUpperCase();
  }
}

// ============================================
// Protected Route Guard
// ============================================
function requireAuth() {
  if (!Auth.isLoggedIn()) {
    window.location.href = getBasePath() + 'pages/login.html?redirect=' + encodeURIComponent(window.location.href);
    return false;
  }
  return true;
}

// ============================================
// Form Validation
// ============================================
const Validator = {
  rules: {
    required: (val) => val.trim() !== '' || 'This field is required.',
    email: (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) || 'Please enter a valid email address.',
    minLength: (min) => (val) => val.length >= min || `Must be at least ${min} characters.`,
    maxLength: (max) => (val) => val.length <= max || `Must be at most ${max} characters.`,
    number: (val) => !isNaN(parseFloat(val)) || 'Must be a valid number.',
    positive: (val) => parseFloat(val) > 0 || 'Must be a positive number.',
    passwordMatch: (confirmId) => (val) => {
      const other = document.getElementById(confirmId)?.value;
      return val === other || "Passwords don't match.";
    },
  },

  validate(fieldEl, rules) {
    const val = fieldEl.value || '';
    const errorEl = fieldEl.parentElement.querySelector('.form-error') ||
                    fieldEl.parentElement.parentElement.querySelector('.form-error');
    for (const rule of rules) {
      const result = rule(val);
      if (result !== true) {
        fieldEl.classList.add('error');
        if (errorEl) { errorEl.textContent = result; errorEl.classList.add('show'); }
        return false;
      }
    }
    fieldEl.classList.remove('error');
    if (errorEl) errorEl.classList.remove('show');
    return true;
  },

  validateForm(formEl, fieldRules) {
    let valid = true;
    for (const [id, rules] of Object.entries(fieldRules)) {
      const field = formEl.querySelector(`#${id}`);
      if (field && !this.validate(field, rules)) valid = false;
    }
    return valid;
  }
};

// ============================================
// Date Utilities
// ============================================
const DateUtils = {
  format(dateStr, opts = {}) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...opts });
  },
  formatTime(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  },
  today() { return new Date().toISOString().split('T')[0]; },
  dayOfWeek(dateStr) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[new Date(dateStr).getDay()];
  },
  startOfWeek() {
    const d = new Date();
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    return d.toISOString().split('T')[0];
  },
  daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  }
};

// ============================================
// Number Formatting
// ============================================
function formatNumber(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

function animateNumber(el, from, to, duration = 800) {
  const start = performance.now();
  const update = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(from + (to - from) * eased).toLocaleString();
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

// ============================================
// Progress Bar Animation
// ============================================
function animateProgressBars() {
  document.querySelectorAll('.progress-fill[data-width]').forEach(bar => {
    const target = bar.getAttribute('data-width');
    setTimeout(() => { bar.style.width = target; }, 100);
  });
}

// ============================================
// Modal Utility
// ============================================
const Modal = {
  show(id) {
    const m = document.getElementById(id);
    if (m) { m.classList.add('show'); document.body.style.overflow = 'hidden'; }
  },
  hide(id) {
    const m = document.getElementById(id);
    if (m) { m.classList.remove('show'); document.body.style.overflow = ''; }
  },
  init() {
    document.querySelectorAll('[data-modal-target]').forEach(btn => {
      btn.addEventListener('click', () => Modal.show(btn.dataset.modalTarget));
    });
    document.querySelectorAll('.modal-close, [data-modal-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const overlay = btn.closest('.modal-overlay');
        if (overlay) { overlay.classList.remove('show'); document.body.style.overflow = ''; }
      });
    });
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { overlay.classList.remove('show'); document.body.style.overflow = ''; }
      });
    });
  }
};

// ============================================
// Logout Button
// ============================================
function initLogout() {
  document.querySelectorAll('[data-logout]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      Auth.logout();
    });
  });
}

// ============================================
// Path Helper (for pages/ subdirectory)
// ============================================
function getBasePath() {
  const isInPages = window.location.pathname.includes('/pages/');
  return isInPages ? '../' : './';
}

// ============================================
// Sample / Mock Data Generator
// ============================================
const MockData = {
  seedWorkouts(userId) {
    const existing = Storage.get(STORAGE_KEYS.WORKOUTS, []);
    if (existing.some(w => w.userId === userId)) return;

    const exercises = [
      { name: 'Bench Press', category: 'Strength' },
      { name: 'Squats', category: 'Strength' },
      { name: 'Running', category: 'Cardio' },
      { name: 'Pull-ups', category: 'Strength' },
      { name: 'Deadlift', category: 'Strength' },
      { name: 'Cycling', category: 'Cardio' },
      { name: 'Push-ups', category: 'Strength' },
      { name: 'Plank', category: 'Core' },
    ];

    const workouts = [];
    for (let i = 6; i >= 0; i--) {
      const date = DateUtils.daysAgo(i);
      const ex = exercises[Math.floor(Math.random() * exercises.length)];
      workouts.push({
        id: Date.now() + i,
        userId,
        exercise: ex.name,
        category: ex.category,
        sets: Math.floor(Math.random() * 3) + 3,
        reps: Math.floor(Math.random() * 8) + 8,
        weight: Math.floor(Math.random() * 40) + 20,
        duration: Math.floor(Math.random() * 45) + 15,
        date,
        notes: '',
        createdAt: new Date(date).toISOString(),
      });
    }
    Storage.set(STORAGE_KEYS.WORKOUTS, [...existing, ...workouts]);
  },

  seedNutrition(userId) {
    const existing = Storage.get(STORAGE_KEYS.NUTRITION, []);
    if (existing.some(n => n.userId === userId)) return;

    const entries = [];
    for (let i = 6; i >= 0; i--) {
      const date = DateUtils.daysAgo(i);
      entries.push({
        id: Date.now() + i + 1000,
        userId,
        date,
        calories: Math.floor(Math.random() * 800) + 1800,
        protein: Math.floor(Math.random() * 50) + 120,
        carbs: Math.floor(Math.random() * 100) + 150,
        fat: Math.floor(Math.random() * 30) + 50,
        water: Math.floor(Math.random() * 4) + 6,
      });
    }
    Storage.set(STORAGE_KEYS.NUTRITION, [...existing, ...entries]);
  },

  seedGoals(userId) {
    const existing = Storage.get(STORAGE_KEYS.GOALS, []);
    if (existing.some(g => g.userId === userId)) return;

    const goals = [
      { id: Date.now() + 1, userId, name: 'Daily Steps', target: 10000, current: 8432, unit: 'steps', period: 'daily', color: '#00d4aa' },
      { id: Date.now() + 2, userId, name: 'Calories Burned', target: 800, current: 642, unit: 'kcal', period: 'daily', color: '#ff6b35' },
      { id: Date.now() + 3, userId, name: 'Weekly Workouts', target: 5, current: 3, unit: 'sessions', period: 'weekly', color: '#5b8cff' },
      { id: Date.now() + 4, userId, name: 'Water Intake', target: 8, current: 6, unit: 'glasses', period: 'daily', color: '#14b8a6' },
    ];
    Storage.set(STORAGE_KEYS.GOALS, [...existing, ...goals]);
  }
};

// ============================================
// Dark Mode (persists)
// ============================================
function initThemeToggle() {
  const toggle = document.getElementById('themeToggle');
  const savedTheme = localStorage.getItem('fittrack_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  if (toggle) {
    toggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('fittrack_theme', next);
    });
  }
}

// ============================================
// Initialize on DOM ready
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  Toast.init();
  Modal.init();
  initNavbar();
  initSidebar();
  initLogout();
  initThemeToggle();
  animateProgressBars();

  // Fade in page
  document.body.style.opacity = '0';
  document.body.style.transition = 'opacity 0.4s ease';
  requestAnimationFrame(() => { document.body.style.opacity = '1'; });
});
