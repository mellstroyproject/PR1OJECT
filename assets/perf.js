// Производительность: пока идёт прокрутка, ставим класс scrolling (анимации на паузе), через 180 мс после последнего шага снимаем
(function(){
  var R = document.documentElement, t = 0;
  addEventListener('scroll', function(){
    if (!R.classList.contains('scrolling')) R.classList.add('scrolling');
    clearTimeout(t);
    t = setTimeout(function(){ R.classList.remove('scrolling'); }, 180);
  }, { passive: true, capture: true });
})();
