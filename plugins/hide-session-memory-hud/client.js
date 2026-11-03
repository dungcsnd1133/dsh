window.__ModuleLoader__.load({
  id: '@local/hide-session-memory-hud',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    function HideSessionMemoryHud() {
      return h('style', {
        'data-hide-session-memory-hud': '',
      }, '.dshmem_hud{display:none !important}');
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'hide-session-memory-hud',
          order: 90,
        }, HideSessionMemoryHud));
      },
    };
  },
});
