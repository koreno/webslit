/*jslint browser:true */
'use strict';

var jQuery;
var wbs = {};
var vue_explorer;
var wbs_connect;
var schema = 'v1';


Vue.config.keyCodes = {
  backspace: 8,
  slash: 191,
  f1: 112
}


const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];


function getFormattedDate(date, prefomattedDate = false, hideYear = false) {
  const day = date.getDate();
  const month = MONTH_NAMES[date.getMonth()] + ".";
  const year = date.getFullYear();
  const hours = date.getHours();
  let minutes = date.getMinutes();

  if (minutes < 10) {
    // Adding leading zero to minutes
    minutes = `0${ minutes }`;
  }

  if (prefomattedDate) {
    // Today at 10:20
    // Yesterday at 10:20
    return `${ prefomattedDate } at ${ hours }:${ minutes }`;
  }

  if (hideYear) {
    return `${ month } ${ day } at ${ hours }:${ minutes } (browser time)`;
  }

  return `${ year } ${ month } ${ day } at ${ hours }:${ minutes } (browser time)`;
}


// --- Main function
function timeAgo(dateParam) {
  if (!dateParam) {
    return null;
  }

  const date = typeof dateParam === 'object' ? dateParam : new Date(dateParam);
  const DAY_IN_MS = 86400000; // 24 * 60 * 60 * 1000
  const today = new Date();
  const yesterday = new Date(today - DAY_IN_MS);
  const seconds = Math.round((today - date) / 1000);
  const minutes = Math.round(seconds / 60);
  const isToday = today.toDateString() === date.toDateString();
  const isYesterday = yesterday.toDateString() === date.toDateString();
  const isThisYear = today.getFullYear() === date.getFullYear();


  if (seconds < 5) {
    return 'now';
  } else if (seconds < 60) {
    return `${ seconds } seconds ago`;
  } else if (seconds < 90) {
    return 'about a minute ago';
  } else if (minutes < 60) {
    return `${ minutes } minutes ago`;
  } else if (isToday) {
    return getFormattedDate(date, 'Today'); // Today at 10:20
  } else if (isYesterday) {
    return getFormattedDate(date, 'Yesterday'); // Yesterday at 10:20
  } else if (isThisYear) {
    return getFormattedDate(date, false, true); // Jan. 10 at 10:20
  }

  return getFormattedDate(date); // 2017 Jan. 10 at 10:20
}


Vue.component('time-ago', {
  props: ['absolute_time'],
  data: function() {return {tick: 0, timeout_id: null}},
  updated: function () {
    if (!this.absolute_time) {
      return;
    }
    var now = new Date();
    var seconds = (now - this.date) / 1000;
    if (seconds / 60 < 60) {
      this.timeout_id = setTimeout(this.do_tick, seconds <= 60 ? 1000 : (15*1000));
    }
  },
  destroyed: function() {
    clearTimeout(this.timeout_id);
  },
  methods: {
    do_tick: function() {
      this.tick += 1;
    }
  },
  computed: {
    date: function() {
      return this.absolute_time ? new Date(this.absolute_time) : null;
    },
    ago_time: function() {
      var d = this.tick;
      return this.date ? timeAgo(this.date): "-";
    }
  },
  template: '<td :title="absolute_time">{{ ago_time }}</td>'
});


(function() {
  // For FormData without getter and setter
  var proto = FormData.prototype,
      data = {};

  if (!proto.get) {
    proto.get = function (name) {
      if (data[name] === undefined) {
        var input = document.querySelector(`input[name="${ name }"]`),
            value;
        if (input) {
          value = input.value;
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


jQuery(function($){
  var status = $('#status'),
      screen = $('#help-screen'),
      form_container = $('.form-container'),
      waiter = $('#waiter'),
      event_origin,
      menu_items = null
      ;

  function toggle_fullscreen(term) {
    var func = term.toggleFullScreen || term.toggleFullscreen;
    func.call(term, true);
  }

  function current_geometry(term) {
    var width = term._core.renderer.dimensions.actualCellWidth;
    var height = term._core.renderer.dimensions.actualCellHeight;
    var cols = parseInt(window.innerWidth / width, 10) - 1;
    var rows = parseInt(window.innerHeight / height, 10);
    return {'cols': cols, 'rows': rows};
  }

  function resize_terminal(term, font_size) {
    if (font_size) {
      if (font_size == 'reset') {
        font_size = 15;
      } else {
        font_size = parseInt(term.getOption("fontSize")) + font_size;
      }
      term.setOption("fontSize", font_size);
      window.localStorage.setItem("font-size", font_size);
    }
    var geometry = current_geometry(term);
    term.on_resize(geometry.cols, geometry.rows);
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

  function hide_help(e) {
    if (e.type === "keyup" && e.key !== "Escape") {
        return;
    }
    screen.hide();
    $(document).unbind('keypress', hide_help);
    $(document).unbind('keyup', hide_help);
    if (wbs.term) {
      wbs.term.focus();
    } else {
      vue_explorer.focus();
    }
  }

  function show_help() {
    screen.show();
    if (wbs.term) {
      $("#webslit-help").hide();
      $("#slit-help").show();
    } else {
      vue_explorer.unfocus();
      $("#slit-help").hide();
      $("#webslit-help").show();
      $(".carousel-control-next").focus();
    }
    // screen.focus();
    // screen.click(hide_help);
    $(document).keypress(hide_help);
    $(document).keyup(hide_help);

  }

  $("#toggle-help-view").click(function(e) {
      $("#webslit-help").toggle();
      $("#slit-help").toggle();
      e.stopPropagation();
  });

  $("#toggle-help-screen").click(function(e) {
      show_help();
      e.stopPropagation();
  });

  (function() {
    $('.modal').on('shown.bs.modal', function() {
      $(this).find('[autofocus]').focus();
    });
  })()

  function cross_origin_connect(event)
  {
    if (!wbs || (typeof event.data != 'string')) {
      return;
    }

    var prop = 'connect',
        args;

    try {
      args = JSON.parse(event.data);
    } catch (SyntaxError) {
      args = event.data.split('|');
    }

    console.log(event.origin, args);

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


  wbs_connect = function(worker_id, encoding, on_reset) {

    var ws_url = "ws://" + window.location.host,
        join = (ws_url[ws_url.length-1] === '/' ? '' : '/'),
        url = ws_url + join + '_ws?id=' + worker_id,
        sock = new window.WebSocket(url),
        decoder = window.TextDecoder ? new window.TextDecoder(encoding) : encoding,
        terminal = document.getElementById('terminal'),
        term = new window.Terminal({
          cursorBlink: true,
          fontSize: window.localStorage.getItem("font-size") || 15,
          theme: {
            background: 'black'
          }
        });

    wbs.term = term;

    console.log(url);
    if (!encoding) {
      console.log('Unable to detect the default encoding of your server');
      encoding = 'utf-8'
    } else {
      console.log(`The default encoding of your server is ${encoding}`);
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

    term.on_resize = function(cols, rows) {
      if (cols !== this.cols || rows !== this.rows) {
        console.log('Resizing terminal to geometry: ' + format_geometry(cols, rows));
        this.resize(cols, rows);
        sock.send(JSON.stringify({'resize': [cols, rows]}));
      }
    };

    wbs.reset = function(arg) {
      if (term) {
        term.destroy();
        term = undefined;
      }
      sock = undefined;
      wbs = {};
      on_reset(arg);
    }

    term.attachCustomKeyEventHandler(function(e) {
      if (false) {
      }
      else if (e.ctrlKey) {
        if (false) {}
        else if (e.shiftKey && (e.keyCode == 3)) {
          var copySucceeded = document.execCommand('copy');
          console.log('copy succeeded', copySucceeded);
          return false;
        }
        else if (e.key == "v") {return false;}
        else if (e.key == "insert") {return false;}
        else if (e.key == "0") {
          resize_terminal(term, 'reset');
          e.preventDefault();
        }
        else if (e.key == "-") {
          resize_terminal(term, -1);
          e.preventDefault();
        }
        else if (e.key == "=") {
          resize_terminal(term, 1);
          e.preventDefault();
        }
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
          vue_explorer.go_to_parent();
          return false;
        }
      }
    });

    term.on('data', function(data) {
      if (term.expired) {
        wbs.reset();
        return;
      } else if (data == "\u001BOP") {
        show_help();
      } else {
        sock.send(JSON.stringify({'data': data}));
      }
    });

    sock.onopen = function() {
      term.open(terminal);
      toggle_fullscreen(term);
      term.focus();
    };

    sock.onmessage = function(msg) {
      read_file_as_text(msg.data, term_write, decoder);
    };

    sock.onerror = function(e) {
      console.error(e);
    };

    sock.onclose = function(e) {
      console.log("closed - ", e.reason);
      if (e.goto) {
        window.location.href = e.goto;
      } else if (!wbs.reset) {
      } else if (e.reason == 'eof') {
        wbs.reset()
      } else if (term) {
        term.expired = true;
      }
    };

    $(window).resize(function(){
      if (term) {
        resize_terminal(term);
      }
    });

    var slit_help_key = "got-slit-help-" + $("#slit-help").data("version");
    h = window.localStorage.getItem(slit_help_key) || false;
    if (!h) {
      setTimeout(show_help, 500);
      window.localStorage.setItem(slit_help_key, true);
    }
  }

  if (window.Terminal.applyAddon) {
    window.Terminal.applyAddon(window.fullscreen);
  }

  vue_explorer = new Vue({
    el: '#vue-explorer',
    data: {
      nav_active: true,
      entries: [],
      other_selected_entries: [],
      meta: {},
      breadcrumbs: [],
      breadcrumbs_tail: {},
      error: false,
      active: 0,
      termshark_enabled: Cookies.get("termshark") || "no",
      requested_filter: '',
      filter: '',
      base: '',
      root: '',
      backend: Cookies.get("preferred_port") || window.location.port || "80",
      loading: 0,
      use_regex: false,
      // window_position: 0,
      // window_height: 25,
      _by_path: {},
      _scroll_id: null,
      _filter_id: null
    },
    watch: {
      requested_filter: function() {
        clearTimeout(this.$data._filter_id);
        this.$data._filter_id = setTimeout(() => {
          this.filter = this.requested_filter;
          window.localStorage.setItem(this.filter_key, this.filter);
        }, Math.min(300, this.entries.length / 10));
      },
      filter: function() {
        if (!this.filtered_entries.length) {
          return;
        } else if (this.active_entry.proxy.target) {
          this.active = this.active_entry.proxy.target.index;
        }
      },
      termshark_enabled: function() {
        Cookies.set("termshark", this.termshark_enabled);
      },
      backend: function() {
        Cookies.set("preferred_port", this.backend);
        window.location.reload();
      }
    },
    computed: {
      filtered_entries: function () {
        if (!this.filter) {
          return this.entries;
        } else {
          var filter = this.use_regex ? 
            [(re => re.test.bind(re))(new RegExp(this.filter.toLowerCase()))] : 
            this.filter.split(',').map(f=>f.trim().toLowerCase()).map(f=>(k=>k.includes(f)));
          var proxy = {};
          var filtered = [];
          var is_match = this.is_match;
          this.entries.forEach(function(e, i) {
            e.proxy = proxy;
            if (is_match(e, filter)) {
              e.filtered_index = filtered.length;
              filtered.push(e);
              proxy.target = e;
              proxy = {};
            } else {
              e.filtered_index = -1;
            }
          });
          proxy.target = filtered[filtered.length - 1];
          return filtered;
        }
      },
      active_entry: function() {
        return this.$data.entries.__ob__.value[this.active];
      },
      selected_entries: function() {
        return this.entries.filter(e => e.selectable && e.selected);
      },
      all_selected_entries: function() {
        return this.selected_entries.concat(this.other_selected_entries).sort((a, b) => (a.path < b.path ? -1 : 1));
      },
      position_key: function() {
        return "last-active:" + this.base
      },
      filter_key: function() {
        return "last-filter:" + this.base
      },
    },
    created() {
      document.querySelector("title").text = `WebSlit (${document.location.host}) - Hit <F1> for assistance`;
      this.refresh();
      $(window).on("hashchange", this.refresh);
    },
    methods: {
      is_match: function(entry, filters) {
        if (!filters.length) {
          return true;
        }
        for (var i = 0; i < entry.keywords.length; i++) {
          if (filters[0](entry.keywords[i]) && this.is_match(entry, filters.slice(1))) {
            return true;
          }
        }
        return false;
      },
      toggle_filter: function() {
        this.use_regex = !this.use_regex;
      },
      active_item: function() {
        return document.getElementById("entry-" + this.active);
      },
      save_position() {
        if (this.active_entry) {
          window.localStorage.setItem(this.position_key, this.active_entry.path);
        }
      },
      save_selection() {
        window.localStorage.setItem(schema + "/selected",
          JSON.stringify(this.all_selected_entries.map(
            e => ({
              name: e.name, path: e.path,
              base: e.base, info: e.info || e.size,
              badges: e.badges})))
        );
      },
      restore_position() {
        this.requested_filter = window.localStorage.getItem(this.filter_key) || '';
        var path = window.localStorage.getItem(this.position_key);
        var idx = this.entries.findIndex(p => p.path == path);
        if (idx >= 0) {
          console.debug(`position restored: ${path} (${idx})`)
          this.set_active(idx);
        }
      },
      refresh(base) {
        clearTimeout(this.$data._refresh_id);
        this.error = false;

        if (base != this.base) {
          this.active = 0;
          this.requested_filter = this.filter = '';
          this.entries = [];
        }
        var offset = this.entries.length;

        var base = window.location.hash.substring(1);
        if (!base.startsWith('/')) {
          base = '/' + base;
        }
        if (!base.endsWith('/')) {
          base += '/';
        }
        this.previous = this.base;
        this.base = base;
        fetch('/_entry?path=' + this.base + '&offset=' + offset)
        .then(response => {
          if (!response.ok) {
            throw Error(response.statusText);
          }
          return response.json();
        })
        .then(json => {

          if (json.path != this.base) {
            // obsolete response
            return;
          } else if (json.redirect) {
            document.location.replace(json.redirect);
            return;
          } else if (json.reset) {
            this.entries = [];
          }

          this.root = json.root;
          this.breadcrumbs = json.breadcrumbs;
          this.breadcrumbs_tail = json.breadcrumbs_tail;

          if (json.error) {
            throw Error(json.error);
          }

          this.meta = json.meta;
          if (this.meta.finished_at) {
            this.meta.finished_at_ago = timeAgo(this.meta.finished_at);
          }

          var last_selected = window.localStorage.getItem(schema + "/selected");
          last_selected = last_selected ? JSON.parse(last_selected) : [];
          var by_path = Object.fromEntries(last_selected.map(e => [e.path, e]));
          this.$data._by_path = by_path;

          this.other_selected_entries = $.map(by_path, e => e)
            .filter(e => e.base != this.base)
            .map((e, i) => {e.index = i; return e});

          json.entries.map(e => {
            if (e.power_only && !json.has_power) {
              return;
            }
            e.selected = (e.selectable && by_path[e.path]) ? true : false;
            e.visible = true;
            e.static = e.flags.includes("s");
            e.selectable = e.flags.includes("z");
            e.is_dir = e.flags.includes("d");
            e.is_symlink = e.flags.includes("y");
            e.is_unreachable = e.flags.includes("u");
            e.is_magic = e.flags.includes("m");
            if (!e.path) {
              e.path = e.base.concat(e.name).join('/');
            }
            if (!e.keywords) {
              e.keywords = [e.name.toLowerCase()];
            } else {
              e.keywords = e.keywords.map(k => String(k).toLowerCase());
            }
            e.base = e.base.join('/');
            e.static_path = e.flags.includes("l") ? ('/static-files/' + e.path) : null;
            this.entries.push(e);
          });

          var active_path = this.active_entry ? this.active_entry.path : null;
          this.entries.sort(this.compare).forEach((e, i) => {
            e.index = i;
            if (e.path == active_path) {
              this.active = i;
            }
          });

          if (json.worker_id) {
            this.loading = 0;
            wbs_connect(json.worker_id, json.encoding, (abort) => {
              if (!abort) {
                window.location.hash = this.previous;
              }
            });
          } else {
            if (wbs.reset) {
              wbs.reset(true);
            }
            this.restore_position();
            if (json.incomplete) {
              this.loading += 1;
              var timeout = 100 * Math.sqrt(this.loading);
              this.$data._refresh_id = setTimeout(() => this.refresh(this.base), timeout);
            } else {
              this.loading = 0;
            }
          }
        })
        .catch(error => {
          console.error(error);
          this.error = error;
          this.loading = 0;
        })
      },
      compare(a, b) {
        return (a.priority - b.priority || b.is_dir - a.is_dir || (a.path < b.path ? -1 : 1));
      },
      toggle_selected(all) {
        if (all) {
          this.filtered_entries.forEach(function(e) {
            if (e.selectable) {
              e.selected = !e.selected;
            }
          });
          this.save_selection();
        } else {
          if (this.active_entry.selectable) {
            this.active_entry.selected = !this.active_entry.selected;
            this.save_selection();
          }
        }
      },
      clear_selection() {
        this.other_selected_entries = [];
        this.entries.forEach(function(e) {e.selected = false});
        this.save_selection();
      },
      deselect(idx) {
        var item = this.all_selected_entries[idx];
        if (item.selected) {
          item.selected = false;
        } else {
          this.other_selected_entries.splice(item.index, 1);
        }
        this.save_selection();
        $("#filter").focus();
      },
      load_files() {
        if (! this.all_selected_entries.length) {
          this.error = "Nothing selected! use the '`' (backtick) key to add items to the selection";
        }

        var data = new FormData();
        data.append("_xsrf", Cookies.get("_xsrf"));
        this.all_selected_entries.forEach(e => {data.append("files[]", e.path)});

        fetch('/_ziplog', {
          method: 'post',
          cache: 'no-cache',
          body: data
        })
        .then(response => response.json())
        .then(json => {
          if (!json.worker_id) {
            console.error(json.error);
          } else {
            wbs_connect(json.worker_id, json.encoding, () => $("#filter").focus());
          }
        });
      },
      enter() {
        var active_item = this.active_item();
        if (!active_item) {
          return;
        } else if (this.active_entry.is_unreachable) {
          return;
        } else {
          window.location.href = active_item.href;
        }
      },
      go_to_parent() {
        var parent = this.breadcrumbs[this.breadcrumbs.length-1];
        if (parent) {
          window.location.hash = parent.path;
        }
      },
      focus() {
        this.nav_active = true;
      },
      unfocus() {
        this.nav_active = false;
      },
      set_active(idx) {
        this.active = idx;
        this.scroll_to_active(1);
        $("#filter").focus();
      },
      move_active(offset) {
        var idx;
        if (!this.filtered_entries.length) {
          return;
        } else if (offset == 'first') {
          idx = this.filtered_entries[0].index;
        } else if (offset == 'last') {
          idx = this.filtered_entries[this.filtered_entries.length-1].index;
        } else if (!this.filter) {
          idx = this.active + offset;
          idx = Math.max(0, idx);
          idx = Math.min(idx, this.entries.length-1);
        } else if (!this.filtered_entries.length) {
          return;
        } else {
          idx = this.active_entry.filtered_index + offset;
          idx = Math.max(0, idx);
          idx = Math.min(idx, this.filtered_entries.length-1);
          idx = this.filtered_entries[idx].index;
        }
        var moved = (this.active != idx);
        this.active = idx;
        this.save_position();
        if (moved) {
          this.scroll_to_active(1);
        }
        return moved;
      },
      download(index) {
        var e = this.entries[index];
        var a = document.createElement('a');
        a.href = e.static_path;
        a.setAttribute("download", e.name);
        a.setAttribute("target", "_blank");
        a.click();
        // document.body.appendChild(a);
        // setTimeout(function() {
        //     a.click();
        //     document.body.removeChild(a);
        // }, 66);
        return true;
      },
      scroll_to_active() {
        clearTimeout(this.$data._scroll_id);
        var $container = $(".explorer-container");
        var scroll_id = this.$data._scroll_id = setTimeout(() => {
          var active_item = this.active_item();
          if (!active_item) return;

          var $active_item = $(active_item);
          var top_of_element = active_item.offsetTop;
          var top_of_screen = $container.scrollTop();
          if (top_of_screen > top_of_element) {
            active_item.scrollIntoView(true);
            return
          }
          var bottom_of_element = active_item.offsetTop + $active_item.outerHeight();
          var bottom_of_screen = $container.scrollTop() + $container.innerHeight();
          if (bottom_of_screen < bottom_of_element) {
            active_item.scrollIntoView(false);
            return
          }
        }, 10);
      }
    }
  });

  new Vue({
    el: '#vue-active-sessions',
    data: {
      active_sessions: []
    },
    created() {
      this.refresh();
    },
    methods: {
      show_help() {
        show_help();
      },
      refresh() {
        fetch('/_active_sessions')
        .then(response => {
          if (!response.ok) {
            throw Error(response.statusText);
          }
          return response.json();
        })
        .then(json => {
          this.active_sessions = json.sessions;
        })
        .catch(error => {console.debug(error)})
        .finally(() => {setTimeout(this.refresh, 15*1000)})
      }
    }
  });

  var filter_box = $("#filter");
  filter_box.focus();

  $(document).on('keydown', function(e) {
    if (false) {
    } else if (screen.is(":visible")) {
    } else if (e.key == "x" && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
    } else if (e.key == "PageUp") {
        if (vue_explorer.move_active(-10)) {
          e.preventDefault();
        }
    } else if (e.key == "PageDown") {
        if (vue_explorer.move_active(10)) {
          e.preventDefault();
        }
    } else if (e.key == "End") {
        if (filter_box.is(":focus") && (document.getElementById("filter").selectionStart < filter_box.val().length)) {
        } else if (vue_explorer.move_active('last')) {
          e.preventDefault();
        }
    } else if(e.key == "Home"){
        if (filter_box.is(":focus") && (document.getElementById("filter").selectionStart > 0)) {
        } else if (vue_explorer.move_active('first')) {
          e.preventDefault();
        }
    } else if(e.key == "ArrowUp"){
        if (vue_explorer.move_active(-1)) {
          e.preventDefault();
        }
    } else if (e.key == "ArrowDown") {
        if (vue_explorer.move_active(1)) {
          e.preventDefault();
        }
    } else if (e.key == "Backspace") {
        if (!vue_explorer.requested_filter) {
          e.preventDefault();
          vue_explorer.go_to_parent();
        }
    } else if (e.key == "/") {
        if (e.ctrlKey) {
          vue_explorer.toggle_filter();
          e.preventDefault();
        } else if (filter_box.is(":focus")) {
        } else {
          filter_box.focus();
          e.preventDefault();
        }
    } else if (e.key == "`") {
        vue_explorer.toggle_selected();
        vue_explorer.move_active(1);
        e.preventDefault();
    } else if (e.key == "Escape") {
      if (vue_explorer.requested_filter) {
        var m = (/(.*),[^,]+/).exec(vue_explorer.requested_filter);
        vue_explorer.requested_filter = m ? m[1] : '';
      } else {
        vue_explorer.clear_selection();
      }
    } else if (e.key == "~") {
        vue_explorer.toggle_selected(true);
        e.preventDefault();
    } else if (e.key == "F1") {
        show_help();
        e.preventDefault();
    } else if (e.key == "Enter") {
      if (e.altKey) {
        vue_explorer.load_files();
      } else {
        vue_explorer.enter()
      }
    }
  });

  $('#active-sessions-popper').popover({
      html: true,
      content: function () {
          return $("#active-sessions-content");
      }
  }).on('hide.bs.popover', function () {
      $("#active-sessions-container").append($("#active-sessions"));
  });

  var help_key = "got-webslit-help-" + $("#webslit-help").data("version");
  var h = window.localStorage.getItem(help_key) || false;
  if (!h) {
    setTimeout(show_help, 500);
    window.localStorage.setItem(help_key, true);
  }

});
