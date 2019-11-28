/*jslint browser:true */

var jQuery;
var wbs = {};


(function() {
  // For FormData without getter and setter
  var proto = FormData.prototype,
      data = {};

  if (!proto.get) {
    proto.get = function (name) {
      if (data[name] === undefined) {
        var input = document.querySelector('input[name="' + name + '"]'),
            value;
        if (input) {
          if (input.type === 'file') {
            value = input.files[0];
          } else {
            value = input.value;
          }
          data[name] = value;
        }
      }
      return data[name];
    };
  }

  if (!proto.set) {
    proto.set = function (name, value) {
      data[name] = value;
    };
  }
}());


(function($){
  $.fn.scrollIfNecessary = function() {
    var top_of_element = this.offset().top;
    var bottom_of_element = this.offset().top + this.outerHeight();
    var bottom_of_screen = $(window).scrollTop() + $(window).innerHeight();
    var top_of_screen = $(window).scrollTop();
    if (top_of_screen > top_of_element) {
      this[0].scrollIntoView(true);
    } else if (bottom_of_screen < bottom_of_element) {
      this[0].scrollIntoView(false);
    }
  }
})(jQuery);


jQuery(function($){
  var status = $('#status'),
      screen = $('#help-screen'),
      button = $('.btn-primary'),
      form_container = $('.form-container'),
      waiter = $('#waiter'),
      term_type = $('#term'),
      style = {},
      form_id = '#load',
      debug = document.querySelector(form_id).noValidate,
      custom_font = document.fonts ? document.fonts.values().next().value : undefined,
      default_fonts,
      DISCONNECTED = 0,
      CONNECTING = 1,
      CONNECTED = 2,
      state = DISCONNECTED,
      messages = {1: 'This client is connecting ...', 2: 'This client is already connnected.'},
      key_max_size = 16384,
      fields = ['hostname', 'port', 'username'],
      form_keys = fields.concat(['password', 'totp']),
      opts_keys = ['bgcolor', 'title', 'encoding', 'command', 'term'],
      url_form_data = {},
      url_opts_data = {},
      validated_form_data,
      event_origin,
      hostname_tester = /((^\s*((([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5]))\s*$)|(^\s*((([0-9A-Fa-f]{1,4}:){7}([0-9A-Fa-f]{1,4}|:))|(([0-9A-Fa-f]{1,4}:){6}(:[0-9A-Fa-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){5}(((:[0-9A-Fa-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){4}(((:[0-9A-Fa-f]{1,4}){1,3})|((:[0-9A-Fa-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){3}(((:[0-9A-Fa-f]{1,4}){1,4})|((:[0-9A-Fa-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){2}(((:[0-9A-Fa-f]{1,4}){1,5})|((:[0-9A-Fa-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){1}(((:[0-9A-Fa-f]{1,4}){1,6})|((:[0-9A-Fa-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9A-Fa-f]{1,4}){1,7})|((:[0-9A-Fa-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))(%.+)?\s*$))|(^\s*((?=.{1,255}$)(?=.*[A-Za-z].*)[0-9A-Za-z](?:(?:[0-9A-Za-z]|\b-){0,61}[0-9A-Za-z])?(?:\.[0-9A-Za-z](?:(?:[0-9A-Za-z]|\b-){0,61}[0-9A-Za-z])?)*)\s*$)/;


  function get_object_length(object) {
    return Object.keys(object).length;
  }

  function parse_xterm_style() {
    var text = $('.xterm-helpers style').text();
    var arr = text.split('xterm-normal-char{width:');
    style.width = parseFloat(arr[1]);
    arr = text.split('div{height:');
    style.height = parseFloat(arr[1]);
  }


  function get_cell_size(term) {
    style.width = term._core.renderer.dimensions.actualCellWidth;
    style.height = term._core.renderer.dimensions.actualCellHeight;
  }


  function toggle_fullscreen(term) {
    var func = term.toggleFullScreen || term.toggleFullscreen;
    func.call(term, true);
  }


  function current_geometry(term) {
    if (!style.width || !style.height) {
      try {
        get_cell_size(term);
      } catch (TypeError) {
        parse_xterm_style();
      }
    }

    var cols = parseInt(window.innerWidth / style.width, 10) - 1;
    var rows = parseInt(window.innerHeight / style.height, 10);
    return {'cols': cols, 'rows': rows};
  }


  function resize_terminal(term) {
    var geometry = current_geometry(term);
    term.on_resize(geometry.cols, geometry.rows);
  }


  function set_backgound_color(term, color) {
    term.setOption('theme', {
      background: color
    });
  }


  function custom_font_is_loaded() {
    if (!custom_font) {
      console.log('No custom font specified.');
    } else {
      console.log('Status of custom font ' + custom_font.family + ': ' + custom_font.status);
      if (custom_font.status === 'loaded') {
        return true;
      }
      if (custom_font.status === 'unloaded') {
        return false;
      }
    }
  }

  function update_font_family(term) {
    if (term.font_family_updated) {
      console.log('Already using custom font family');
      return;
    }

    if (!default_fonts) {
      default_fonts = term.getOption('fontFamily');
    }

    if (custom_font_is_loaded()) {
      var new_fonts =  custom_font.family + ', ' + default_fonts;
      term.setOption('fontFamily', new_fonts);
      term.font_family_updated = true;
      console.log('Using custom font family ' + new_fonts);
    }
  }


  function reset_font_family(term) {
    if (!term.font_family_updated) {
      console.log('Already using default font family');
      return;
    }

    if (default_fonts) {
      term.setOption('fontFamily',  default_fonts);
      term.font_family_updated = false;
      console.log('Using default font family ' + default_fonts);
    }
  }


  function format_geometry(cols, rows) {
    return JSON.stringify({'cols': cols, 'rows': rows});
  }


  function read_as_text_with_decoder(file, callback, decoder) {
    var reader = new window.FileReader();

    if (decoder === undefined) {
      decoder = new window.TextDecoder('utf-8', {'fatal': true});
    }

    reader.onload = function() {
      var text;
      try {
        text = decoder.decode(reader.result);
      } catch (TypeError) {
        console.log('Decoding error happened.');
      } finally {
        if (callback) {
          callback(text);
        }
      }
    };

    reader.onerror = function (e) {
      console.error(e);
    };

    reader.readAsArrayBuffer(file);
  }


  function read_as_text_with_encoding(file, callback, encoding) {
    var reader = new window.FileReader();

    if (encoding === undefined) {
      encoding = 'utf-8';
    }

    reader.onload = function() {
      if (callback) {
        callback(reader.result);
      }
    };

    reader.onerror = function (e) {
      console.error(e);
    };

    reader.readAsText(file, encoding);
  }


  function read_file_as_text(file, callback, decoder) {
    if (!window.TextDecoder) {
      read_as_text_with_encoding(file, callback, decoder);
    } else {
      read_as_text_with_decoder(file, callback, decoder);
    }
  }


  function reset_wbs() {
    var name;

    for (name in wbs) {
      if (wbs.hasOwnProperty(name) && name !== 'connect') {
        delete wbs[name];
      }
    }
  }


  function log_status(text, to_populate) {
    console.log(text);
    status.html(text.split('\n').join('<br/>'));

    if (to_populate && validated_form_data) {
      populate_form(validated_form_data);
      validated_form_data = undefined;
    }

    if (waiter.css('display') !== 'none') {
      waiter.hide();
    }

    if (form_container.css('display') === 'none') {
      form_container.show();
    }
  }

  function hide_help(e) {
    if (e.type === "keyup" && e.key !== "Escape") {
        return;
    }
    screen.hide();
    $(document).unbind('keypress', hide_help);
    $(document).unbind('keyup', hide_help);
    if (term) {
      term.focus();
    }
  }

  function show_help() {
    if (wbs.term) {
      $("#webslit-help").hide();
      $("#slit-help").show();
    } else {
      $("#slit-help").hide();
      $("#webslit-help").show();
    }
    screen.show();
    screen.focus();

    screen.click(hide_help);
    $(document).keypress(hide_help);
    $(document).keyup(hide_help);

  }

  $("#toggle-help-view").click(function(e) {
      $("#webslit-help").toggle();
      $("#slit-help").toggle();
      e.stopPropagation();
  });

  function ajax_complete_callback(resp) {
    button.prop('disabled', false);

    if (resp.status !== 200) {
      log_status(resp.status + ': ' + resp.statusText, true);
      state = DISCONNECTED;
      return;
    }

    var msg = resp.responseJSON;
    if (!msg.id) {
      log_status(msg.status, true);
      state = DISCONNECTED;
      return;
    }

    var ws_url = "ws://" + window.location.host,
        join = (ws_url[ws_url.length-1] === '/' ? '' : '/'),
        url = ws_url + join + 'ws?id=' + msg.id,
        sock = new window.WebSocket(url),
        encoding = 'utf-8',
        decoder = window.TextDecoder ? new window.TextDecoder(encoding) : encoding,
        terminal = document.getElementById('terminal'),
        term = new window.Terminal({
          cursorBlink: true,
          theme: {
            background: url_opts_data.bgcolor || 'black'
          }
        });

    wbs.term = term;

    console.log(url);
    if (!msg.encoding) {
      console.log('Unable to detect the default encoding of your server');
      msg.encoding = encoding;
    } else {
      console.log('The default encoding of your server is ' + msg.encoding);
    }

    function term_write(text) {
      if (term) {
        term.write(text);
        if (!term.resized) {
          resize_terminal(term);
          term.resized = true;
        }
      }
    }

    function set_encoding(new_encoding) {
      // for console use
      if (!new_encoding) {
        console.log('An encoding is required');
        return;
      }

      if (!window.TextDecoder) {
        decoder = new_encoding;
        encoding = decoder;
        console.log('Set encoding to ' + encoding);
      } else {
        try {
          decoder = new window.TextDecoder(new_encoding);
          encoding = decoder.encoding;
          console.log('Set encoding to ' + encoding);
        } catch (RangeError) {
          console.log('Unknown encoding ' + new_encoding);
          return false;
        }
      }
    }

    wbs.set_encoding = set_encoding;

    set_encoding(msg.encoding);


    wbs.geometry = function() {
      // for console use
      var geometry = current_geometry(term);
      console.log('Current window geometry: ' + JSON.stringify(geometry));
    };

    wbs.send = function(data) {
      // for console use
      if (!sock) {
        console.log('Websocket was already closed');
        return;
      }

      if (typeof data !== 'string') {
        console.log('Only string is allowed');
        return;
      }

      try {
        JSON.parse(data);
        sock.send(data);
      } catch (SyntaxError) {
        data = data.trim() + '\r';
        sock.send(JSON.stringify({'data': data}));
      }
    };

    wbs.reset_encoding = function() {
      // for console use
      if (encoding === msg.encoding) {
        console.log('Already reset to ' + msg.encoding);
      } else {
        set_encoding(msg.encoding);
      }
    };

    wbs.resize = function(cols, rows) {
      // for console use
      if (term === undefined) {
        console.log('Terminal was already destroryed');
        return;
      }

      var valid_args = false;

      if (cols > 0 && rows > 0)  {
        var geometry = current_geometry(term);
        if (cols <= geometry.cols && rows <= geometry.rows) {
          valid_args = true;
        }
      }

      if (!valid_args) {
        console.log('Unable to resize terminal to geometry: ' + format_geometry(cols, rows));
      } else {
        term.on_resize(cols, rows);
      }
    };

    wbs.set_bgcolor = function(color) {
      set_backgound_color(term, color);
    };

    wbs.custom_font = function() {
      update_font_family(term);
    };

    wbs.default_font = function() {
      reset_font_family(term);
    };

    term.on_resize = function(cols, rows) {
      if (cols !== this.cols || rows !== this.rows) {
        console.log('Resizing terminal to geometry: ' + format_geometry(cols, rows));
        this.resize(cols, rows);
        sock.send(JSON.stringify({'resize': [cols, rows]}));
      }
    };

    term.attachCustomKeyEventHandler(function(e) {
      if (false) {
      }
      else if (e.ctrlKey) {
        if (false) {}
        else if (e.key == "c") {return false;}
        else if (e.key == "v") {return false;}
        else if (e.key == "insert") {return false;}
      }
      else if (e.shiftKey) {
        if (false) {}
        else if (e.key == "insert") {return false;}
      }
      else if (e.altKey) {
        if (false) {}
        else if (e.key == "d") {return false;}
        else if (e.key == "ArrowLeft") {return false;}
        else if (e.key == "ArrowRight") {return false;}
        else if (e.key == "ArrowUp") {
          window.location.href = window.location.href.split('/').slice(0, -1).join('/');
          return false;
        }
      }
    });

    term.on('data', function(data) {
      if (data == "\u001BOP") {
        show_help();
      } else {
        sock.send(JSON.stringify({'data': data}));
      }
    });

    sock.onopen = function() {
      term.open(terminal);
      toggle_fullscreen(term);
      update_font_family(term);
      term.focus();
      state = CONNECTED;
      if (url_opts_data.command) {
        setTimeout(function () {
          sock.send(JSON.stringify({'data': url_opts_data.command+'\r'}));
        }, 500);
      }
    };

    sock.onmessage = function(msg) {
      read_file_as_text(msg.data, term_write, decoder);
    };

    sock.onerror = function(e) {
      console.error(e);
    };

    sock.onclose = function(e) {
      term.destroy();
      term = undefined;
      sock = undefined;
      reset_wbs();
      if (e.reason) {
        log_status(e.reason, true);
      } else if (e.goto) {
        window.location.href = e.goto;
      } else {
        window.location.href = window.location.href.split('/').slice(0, -1).join('/')
      }

      state = DISCONNECTED;
    };

    $(window).resize(function(){
      if (term) {
        resize_terminal(term);
      }
    });

    document.querySelector("title").text += " (Hit 'F1' for Help)";
    h = window.localStorage.getItem("got-help") || false;
    if (!h) {
      setTimeout(show_help, 500);
      window.localStorage.setItem("got-help", true);
    }
  }


  function wrap_object(opts) {
    var obj = {};

    obj.get = function(attr) {
      return opts[attr] || '';
    };

    obj.set = function(attr, val) {
      opts[attr] = val;
    };

    return obj;
  }


  function clean_data(data) {
    var i, attr, val;
    var attrs = form_keys.concat([]);

    for (i = 0; i < attrs.length; i++) {
      attr = attrs[i];
      val = data.get(attr);
      if (typeof val === 'string') {
        data.set(attr, val.trim());
      }
    }
  }


  function validate_form_data(data) {
    clean_data(data);

    var filepath = data.get('filepath'),
        result = {
          valid: false,
          data: data,
          title: ''
        },
        errors = [], size;

    if (!errors.length || debug) {
      result.valid = true;
      result.title = 'WebSlit: ' + filepath;
    }
    result.errors = errors;

    return result;
  }


  function connect_from_form() {
    // use data from the form
    var form = document.querySelector(form_id),
        url = form.action,
        data;

    data = new FormData(form);

    function ajax_post() {
      status.text('');
      button.prop('disabled', true);

      $.ajax({
          url: url,
          type: 'post',
          data: data,
          complete: ajax_complete_callback,
          cache: false,
          contentType: false,
          processData: false
      });
    }

    var result = validate_form_data(data);
    if (!result.valid) {
      log_status(result.errors.join('\n'));
      return;
    }

    ajax_post();

    return result;
  }


  function connect_with_options(data) {
    // use data from the arguments
    var form = document.querySelector(form_id),
        url = data.url || form.action,
        _xsrf = form.querySelector('input[name="_xsrf"]');

    var result = validate_form_data(wrap_object(data));
    if (!result.valid) {
      log_status(result.errors.join('\n'));
      return;
    }

    data.term = term_type.val();
    data._xsrf = _xsrf.value;
    if (event_origin) {
      data._origin = event_origin;
    }

    status.text('');
    button.prop('disabled', true);

    $.ajax({
        url: url,
        type: 'post',
        data: data,
        complete: ajax_complete_callback
    });

    return result;
  }


  function connect(hostname, port, username, password, privatekey, passphrase, totp) {
    // for console use
    var result, opts;

    if (state !== DISCONNECTED) {
      console.log(messages[state]);
      return;
    }

    if (hostname === undefined) {
      result = connect_from_form();
    } else {
      if (typeof hostname === 'string') {
        opts = {
          hostname: hostname,
          port: port,
          username: username,
          password: password,
          privatekey: privatekey,
          passphrase: passphrase,
          totp: totp
        };
      } else {
        opts = hostname;
      }

      result = connect_with_options(opts);
    }

    if (result) {
      state = CONNECTING;
      if (hostname) {
        validated_form_data = result.data;
      }
    }
  }

  wbs.connect = connect;

  $(form_id).submit(function(event){
    event.preventDefault();
    connect();
  });


  function cross_origin_connect(event)
  {
    console.log(event.origin);
    var prop = 'connect',
        args;

    try {
      args = JSON.parse(event.data);
    } catch (SyntaxError) {
      args = event.data.split('|');
    }

    if (!Array.isArray(args)) {
      args = [args];
    }

    try {
      event_origin = event.origin;
      wbs[prop].apply(wbs, args);
    } finally {
      event_origin = undefined;
    }
  }

  window.addEventListener('message', cross_origin_connect, false);

  if (window.Terminal.applyAddon) {
    window.Terminal.applyAddon(window.fullscreen);
  }

  if (document.fonts) {
    document.fonts.ready.then(
      function () {
        if (custom_font_is_loaded() === false) {
          document.body.style.fontFamily = custom_font.family;
        }
      }
    );
  }

  if (auto_load) {
    $(form_id).submit();
  } else {
    function set_active(idx) {
      idx = Math.min(menu_items.length-1, Math.max(0, idx));
      item = $(".explorer-container a[href='"+menu_items[idx]+"']");
      $(".explorer-container a.active").removeClass("active");
      item.addClass('active');
      item.scrollIfNecessary();
      moved = (active != idx);
      active = idx;
      window.localStorage.setItem(storageKey, menu_items[idx]);
      return moved;
    }

    var storageKey = window.location.pathname + "/last-active";
    var menu_items = $(".explorer-container a").map(function(i, e) { return $(e).attr("href"); }).get();
    var last_active = window.localStorage.getItem(storageKey);
    var active = Math.max(0, menu_items.indexOf(last_active));
    set_active(active);

    $(".explorer-container a").on('mouseenter', function(e) {
      var idx = menu_items.indexOf($(e.target).attr("href"));
      set_active(idx);
    });

    $(document).on('keydown', function(e) {
      if (false) {
      } else if (e.key == "PageUp") {
          if (set_active(active - 10)) {
            e.preventDefault();
          }
      } else if (e.key == "PageDown") {
          if (set_active(active + 10)) {
            e.preventDefault();
          }
      } else if (e.key == "End") {
          if (set_active(menu_items.length-1)) {
            e.preventDefault();
          }
      } else if(e.key == "Home"){
          if (set_active(0)) {
            e.preventDefault();
          }
      } else if(e.key == "ArrowUp"){
          if (set_active(active - 1)) {
            e.preventDefault();
          }
      } else if (e.key == "ArrowDown") {
          if (set_active(active + 1)) {
            e.preventDefault();
          }
      } else if (e.key == "F1") {
          show_help();
          e.preventDefault();
      } else if (e.key == "Enter") {
          var selected_item = $('.explorer-container a.active');
          window.location.href = selected_item.attr("href")
      }
    });


  }

});
