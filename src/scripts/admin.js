/* Admin conveniences (all optional — forms work without JS). */
(function () {
  // Character counters: <input data-count="60">
  document.querySelectorAll('[data-count]').forEach(function (el) {
    var max = Number(el.getAttribute('data-count'));
    var label = document.querySelector('label[for="' + el.id + '"]');
    if (!label) return;
    var c = document.createElement('span');
    c.className = 'counter';
    c.setAttribute('aria-live', 'polite');
    label.appendChild(c);
    function update() {
      c.textContent = el.value.length + ' / ' + max;
      c.classList.toggle('over', el.value.length > max);
    }
    el.addEventListener('input', update);
    update();
  });

  // Auto-slug from title while the slug field is untouched.
  var title = document.getElementById('title');
  var slug = document.getElementById('slug');
  if (title && slug) {
    var touched = slug.value.length > 0;
    slug.addEventListener('input', function () { touched = true; });
    title.addEventListener('input', function () {
      if (touched) return;
      slug.value = title.value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    });
  }

  // Add FAQ rows.
  var addFaq = document.querySelector('[data-add-faq]');
  if (addFaq) {
    addFaq.hidden = false;
    addFaq.addEventListener('click', function () {
      var list = document.getElementById('faq-list');
      var n = list.querySelectorAll('.faq-row').length + 1;
      var row = document.createElement('div');
      row.className = 'faq-row';
      row.innerHTML = '<label for="faq_q_' + n + '">Question ' + n + '</label><input type="text" id="faq_q_' + n + '" name="faq_q" maxlength="300">' +
        '<label for="faq_a_' + n + '" style="margin-top:.4rem">Answer ' + n + '</label><textarea id="faq_a_' + n + '" name="faq_a" maxlength="2000"></textarea>';
      list.appendChild(row);
      row.querySelector('input').focus();
    });
  }

  // Confirm destructive actions.
  document.querySelectorAll('[data-confirm]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      if (!window.confirm(el.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  // Featured image preview.
  var imgSel = document.getElementById('featuredImageId');
  var preview = document.getElementById('featured-preview');
  if (imgSel && preview) {
    imgSel.addEventListener('change', function () {
      var opt = imgSel.options[imgSel.selectedIndex];
      var src = opt && opt.getAttribute('data-thumb');
      preview.hidden = !src;
      if (src) preview.src = src;
    });
  }
})();
