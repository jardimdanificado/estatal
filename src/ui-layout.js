const UI_LAYOUT = {
  enabled: true,
  layers: {
    hud: {
      id: 'hud',
      elements: [
        {
          id: 'hud_panel',
          type: 'image',
          x: 10,
          y: 10,
          width: 312,
          height: 96,
          flatColor: 'rgba(0,0,0,0.22)',
          opacity: 1,
          style: {
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '10px',
            boxShadow: '0 3px 10px rgba(0,0,0,0.45)',
            pointerEvents: 'none'
          }
        },
        {
          id: 'hud_player_photo',
          type: 'image',
          x: 22,
          y: 22,
          width: 68,
          height: 68,
          spriteVar: 'playerPortraitTexture',
          spriteFit: 'cover',
          style: {
            borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.45)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.5)'
          }
        },
        {
          id: 'hud_player_name',
          type: 'text',
          x: 14,
          y: 88,
          width: 84,
          height: 16,
          text: '{{playerName}}',
          textColor: '#ffffff',
          fontSize: 13,
          align: 'center',
          style: {
            textTransform: 'uppercase',
            letterSpacing: '0.4px',
            textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
          }
        },
        {
          id: 'hud_stats',
          type: 'text',
          x: 108,
          y: 24,
          width: 146,
          height: 60,
          text: '{{hudStatsText}}',
          textColor: '#ffffff',
          fontSize: 15,
          align: 'left',
          style: {
            fontFamily: '"Courier New", monospace',
            whiteSpace: 'pre-line',
            lineHeight: '1.4',
            textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
          }
        },
        {
          id: 'hud_item_preview_bg',
          type: 'image',
          x: 262,
          y: 34,
          width: 48,
          height: 48,
          flatColor: 'rgba(0,0,0,0.35)',
          style: {
            border: '1px solid rgba(255,255,255,0.4)',
            boxShadow: 'inset 0 0 10px rgba(0,0,0,0.6)'
          }
        },
        {
          id: 'hud_item_preview',
          type: 'image',
          x: 262,
          y: 34,
          width: 48,
          height: 48,
          spriteVar: 'selectedItemTexture',
          spriteFit: 'contain'
        },
        {
          id: 'hud_hand',
          type: 'image',
          anchorX: 'right',
          anchorY: 'bottom',
          x: 0,
          y: -80,
          width: 420,
          height: 420,
          spriteVar: 'selectedHandTexture',
          spriteFit: 'contain',
          style: {
            pointerEvents: 'none',
            zIndex: '2'
          }
        }
      ]
    },
    mobile: {
      id: 'mobile',
      elements: [
        {
          id: 'look_zone',
          type: 'button',
          x: 0,
          y: 0,
          width: 2048,
          height: 2048,
          text: '',
          flatColor: 'rgba(0,0,0,0)',
          action: 'look_drag',
          style: { zIndex: '1' }
        },

        { id: 'mv_w', type: 'button', anchorX: 'left', anchorY: 'bottom', x: 84, y: 152, width: 60, height: 60, text: 'W', flatColor: 'rgba(0,0,0,0.4)', textColor: '#ffffff', action: 'key_hold', keyCode: 'KeyW', style: { borderRadius: '10px', border: '1px solid rgba(255,255,255,0.4)', zIndex: '3' } },
        { id: 'mv_a', type: 'button', anchorX: 'left', anchorY: 'bottom', x: 16, y: 84, width: 60, height: 60, text: 'A', flatColor: 'rgba(0,0,0,0.4)', textColor: '#ffffff', action: 'key_hold', keyCode: 'KeyA', style: { borderRadius: '10px', border: '1px solid rgba(255,255,255,0.4)', zIndex: '3' } },
        { id: 'mv_d', type: 'button', anchorX: 'left', anchorY: 'bottom', x: 152, y: 84, width: 60, height: 60, text: 'D', flatColor: 'rgba(0,0,0,0.4)', textColor: '#ffffff', action: 'key_hold', keyCode: 'KeyD', style: { borderRadius: '10px', border: '1px solid rgba(255,255,255,0.4)', zIndex: '3' } },
        { id: 'mv_s', type: 'button', anchorX: 'left', anchorY: 'bottom', x: 84, y: 84, width: 60, height: 60, text: 'S', flatColor: 'rgba(0,0,0,0.4)', textColor: '#ffffff', action: 'key_hold', keyCode: 'KeyS', style: { borderRadius: '10px', border: '1px solid rgba(255,255,255,0.4)', zIndex: '3' } },

        { id: 'act_shoot', type: 'button', anchorX: 'right', anchorY: 'bottom', x: 94, y: 84, width: 70, height: 60, text: 'Shoot', flatColor: 'rgba(0,0,0,0.4)', textColor: '#ffffff', action: 'primary_action', style: { borderRadius: '10px', border: '1px solid rgba(255,255,255,0.4)', zIndex: '3' } },
        { id: 'act_use', type: 'button', anchorX: 'right', anchorY: 'bottom', x: 16, y: 84, width: 70, height: 60, text: 'Action', flatColor: 'rgba(0,0,0,0.4)', textColor: '#ffffff', action: 'secondary_action', style: { borderRadius: '10px', border: '1px solid rgba(255,255,255,0.4)', zIndex: '3' } },
        { id: 'act_drop', type: 'button', anchorX: 'right', anchorY: 'bottom', x: 94, y: 16, width: 70, height: 60, text: 'Drop', flatColor: 'rgba(0,0,0,0.4)', textColor: '#ffffff', action: 'drop_selected', style: { borderRadius: '10px', border: '1px solid rgba(255,255,255,0.4)', zIndex: '3' } },
        { id: 'act_jump', type: 'button', anchorX: 'right', anchorY: 'bottom', x: 16, y: 16, width: 70, height: 60, text: 'Jump', flatColor: 'rgba(0,0,0,0.4)', textColor: '#ffffff', action: 'jump', style: { borderRadius: '10px', border: '1px solid rgba(255,255,255,0.4)', zIndex: '3' } },
        { id: 'act_down', type: 'button', anchorX: 'right', anchorY: 'bottom', x: 16, y: 152, width: 70, height: 60, text: 'Down', flatColor: 'rgba(0,0,0,0.4)', textColor: '#ffffff', action: 'down_hold', style: { borderRadius: '10px', border: '1px solid rgba(255,255,255,0.4)', zIndex: '3' } },

        { id: 'top_prev', type: 'button', anchorX: 'left', anchorY: 'top', x: 0, y: 0, width: 42, height: 42, text: 'Prev', flatColor: 'rgba(0,0,0,0.4)', textColor: '#ffffff', action: 'step_prev', style: { left: 'calc(50% - 140px)', top: '10px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.4)', zIndex: '4', fontSize: '11px' } },
        { id: 'top_next', type: 'button', anchorX: 'left', anchorY: 'top', x: 0, y: 0, width: 42, height: 42, text: 'Next', flatColor: 'rgba(0,0,0,0.4)', textColor: '#ffffff', action: 'step_next', style: { left: 'calc(50% - 92px)', top: '10px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.4)', zIndex: '4', fontSize: '11px' } },
        { id: 'top_mode', type: 'button', anchorX: 'left', anchorY: 'top', x: 0, y: 0, width: 42, height: 42, text: 'Mode', flatColor: 'rgba(0,0,0,0.4)', textColor: '#ffffff', action: 'toggle_mode', style: { left: 'calc(50% - 44px)', top: '10px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.4)', zIndex: '4', fontSize: '11px' } },
        { id: 'top_menu', type: 'button', anchorX: 'left', anchorY: 'top', x: 0, y: 0, width: 42, height: 42, text: 'Menu', flatColor: 'rgba(0,0,0,0.4)', textColor: '#ffffff', action: 'open_editor_menu', style: { left: 'calc(50% + 4px)', top: '10px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.4)', zIndex: '4', fontSize: '11px' } },
        { id: 'top_export', type: 'button', anchorX: 'left', anchorY: 'top', x: 0, y: 0, width: 42, height: 42, text: 'Export', flatColor: 'rgba(0,0,0,0.4)', textColor: '#ffffff', action: 'export_map', style: { left: 'calc(50% - 140px)', top: '58px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.4)', zIndex: '4', fontSize: '11px' } },
        { id: 'top_import', type: 'button', anchorX: 'left', anchorY: 'top', x: 0, y: 0, width: 42, height: 42, text: 'Import', flatColor: 'rgba(0,0,0,0.4)', textColor: '#ffffff', action: 'import_map', style: { left: 'calc(50% - 92px)', top: '58px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.4)', zIndex: '4', fontSize: '11px' } }
      ]
    }
  }
};

export default UI_LAYOUT;
