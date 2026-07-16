// Animate SMS thread bubbles in sequence on load
document.addEventListener('DOMContentLoaded', () => {
  const bubbles = document.querySelectorAll('.thread .bubble, .thread .stamp');
  bubbles.forEach((el, i) => {
    el.style.animationDelay = `${i * 0.55 + 0.2}s`;
  });

  // FAQ accordion
  document.querySelectorAll('.faq-q').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const wasOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach((el) => el.classList.remove('open'));
      if (!wasOpen) item.classList.add('open');
    });
  });

  // Mark active nav link
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a').forEach((a) => {
    if (a.getAttribute('href') === path) a.classList.add('active');
  });
});
