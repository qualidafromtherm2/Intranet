$(function() {
    // Função construtora do Accordion
    var Accordion = function(el, multiple) {
      this.el = el || {};
      this.multiple = multiple || false;
  
      // Seleciona os links do menu
      var links = this.el.find('.link');
  
      // Adiciona o evento de clique
      links.on('click', { el: this.el, multiple: this.multiple }, this.dropdown);
    };
  
    // Método que controla a abertura e fechamento dos itens
    Accordion.prototype.dropdown = function(e) {
      var $el = e.data.el;
      var $this = $(this),
          $next = $this.next();
  
      $next.slideToggle();
      $this.parent().toggleClass('open');
  
      if (!e.data.multiple) {
        $el.find('.submenu').not($next).slideUp().parent().removeClass('open');
      }
    };
  
    // Inicializa o accordion no elemento com id "accordion"
    var accordion = new Accordion($('#accordion'), false);
  });
  