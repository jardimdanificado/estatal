const MENUS = {
  defaultEscapeMenu: 'escape',
  startMenu: 'start',
  menus: {
    start: {
      id: 'start',
      title: 'Iniciar',
      backgroundColor: '#000000',
      elements: [
        {
          id: 'start_title',
          type: 'text',
          x: 80,
          y: 50,
          width: 520,
          height: 52,
          text: '{{gameName}}',
          textColor: '#ffffff',
          fontSize: 38,
          align: 'left'
        },
        {
          id: 'start_play',
          type: 'button',
          x: 80,
          y: 140,
          width: 260,
          height: 46,
          text: 'Jogar',
          flatColor: '#2f7f52',
          textColor: '#ffffff',
          action: 'close_menu'
        },
        {
          id: 'start_save',
          type: 'button',
          x: 80,
          y: 198,
          width: 260,
          height: 46,
          text: 'Salvar',
          flatColor: '#3768af',
          textColor: '#ffffff',
          action: 'open_menu',
          targetMenu: 'save'
        }
      ]
    },
    escape: {
      id: 'escape',
      title: 'Pause',
      backgroundColor: '#000000',
      elements: [
        {
          id: 'escape_title',
          type: 'text',
          x: 80,
          y: 50,
          width: 360,
          height: 48,
          text: 'Jogo Pausado',
          textColor: '#ffffff',
          fontSize: 34,
          align: 'left'
        },
        {
          id: 'escape_resume',
          type: 'button',
          x: 80,
          y: 130,
          width: 240,
          height: 44,
          text: 'Continuar',
          flatColor: '#2f7f52',
          textColor: '#ffffff',
          action: 'close_menu'
        },
        {
          id: 'escape_save',
          type: 'button',
          x: 80,
          y: 186,
          width: 240,
          height: 44,
          text: 'Salvar',
          flatColor: '#3768af',
          textColor: '#ffffff',
          action: 'open_menu',
          targetMenu: 'save'
        }
      ]
    },
    save: {
      id: 'save',
      title: 'Salvar',
      backgroundColor: '#000000',
      elements: [
        {
          id: 'save_title',
          type: 'text',
          x: 80,
          y: 50,
          width: 420,
          height: 48,
          text: 'Menu de Save',
          textColor: '#ffffff',
          fontSize: 30,
          align: 'left'
        },
        {
          id: 'save_name_input',
          type: 'input',
          x: 80,
          y: 130,
          width: 280,
          height: 38,
          placeholder: 'nome do save',
          bind: 'saveName',
          flatColor: '#101010',
          textColor: '#ffffff'
        },
        {
          id: 'save_name_echo',
          type: 'text',
          x: 80,
          y: 180,
          width: 420,
          height: 28,
          text: 'Nome: {{saveName}}',
          textColor: '#ffffff',
          fontSize: 18,
          align: 'left'
        },
        {
          id: 'save_back',
          type: 'button',
          x: 80,
          y: 220,
          width: 240,
          height: 42,
          text: 'Voltar',
          flatColor: '#5a5a5a',
          textColor: '#ffffff',
          action: 'back_menu'
        }
      ]
    }
  }
};

export default MENUS;
