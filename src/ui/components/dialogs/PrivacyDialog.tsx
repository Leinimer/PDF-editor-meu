import { type JSX } from 'react';
import { Modal } from '../Modal';

export interface PrivacyDialogProps {
  open: boolean;
  onClose(): void;
}

export function PrivacyDialog({ open, onClose }: PrivacyDialogProps): JSX.Element | null {
  return (
    <Modal title="Política de Privacidade" open={open} onClose={onClose}>
      <div className="legal-content">
        <p className="muted" style={{ margin: 0 }}>
          Sua privacidade é nossa prioridade máxima. Este editor de PDF opera{' '}
          <strong>100% no seu navegador</strong> (client-side). Seus arquivos e dados nunca são
          enviados a servidores externos.
        </p>

        <section className="legal-section">
          <h3>1. Processamento 100% Local (No-Server)</h3>
          <p>
            Todas as operações de visualização, edição, mesclagem, anotação e compressão ocorrem
            exclusivamente na memória local do seu navegador através de WebAssembly e JavaScript.
          </p>
          <div className="legal-example">
            <strong>Exemplo:</strong> Ao carregar e assinar um contrato confidencial ou documento com
            CPF/RG, o arquivo permanece unicamente no seu dispositivo e nunca trafega por nossos
            servidores.
          </div>
        </section>

        <section className="legal-section">
          <h3>2. Integração Opcional com Google Drive</h3>
          <p>
            Caso você utilize a funcionalidade de abrir ou salvar arquivos no Google Drive, a
            autenticação é feita diretamente entre o seu navegador e a API oficial do Google.
          </p>
          <div className="legal-example">
            <strong>Exemplo:</strong> O token de acesso temporário é mantido apenas na memória volátil
            da sessão e expira automaticamente. Nenhum dado de login ou credencial do Google é
            armazenado ou intermediado por nós.
          </div>
        </section>

        <section className="legal-section">
          <h3>3. Dados em Armazenamento Local (LocalStorage)</h3>
          <p>
            Armazenamos apenas preferências básicas de usabilidade no seu navegador, sem vincular a
            nenhuma identidade pessoal.
          </p>
          <div className="legal-example">
            <strong>Exemplo:</strong> A escolha do tema (modo claro ou escuro) e a lista de nomes dos
            últimos arquivos abertos ficam salvas no seu próprio computador, podendo ser apagadas a
            qualquer momento limpando os dados do navegador.
          </div>
        </section>

        <section className="legal-section">
          <h3>4. Sem Rastreamento e Sem Cookies de Terceiros</h3>
          <p>
            Não utilizamos pixels de rastreamento, cookies de publicidade nem gravadores de sessão. O
            aplicativo é limpo, livre de anúncios e focado em produtividade.
          </p>
          <div className="legal-example">
            <strong>Exemplo:</strong> Você pode navegar e editar documentos sem receber anúncios
            direcionados ou ter seu histórico de navegação monitorado.
          </div>
        </section>
      </div>
      <div className="modal-actions">
        <button type="button" className="button is-primary" onClick={onClose}>
          Entendido
        </button>
      </div>
    </Modal>
  );
}
