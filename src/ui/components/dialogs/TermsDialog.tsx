import { type JSX } from 'react';
import { Modal } from '../Modal';

export interface TermsDialogProps {
  open: boolean;
  onClose(): void;
}

export function TermsDialog({ open, onClose }: TermsDialogProps): JSX.Element | null {
  return (
    <Modal title="Termos de Serviço" open={open} onClose={onClose}>
      <div className="legal-content">
        <p className="muted" style={{ margin: 0 }}>
          Estes termos regulam o uso do Editor de PDF. O serviço é disponibilizado de forma gratuita,
          transparente e de código aberto.
        </p>

        <section className="legal-section">
          <h3>1. Uso Permitido e Finalidade</h3>
          <p>
            Você tem total liberdade para usar o aplicativo para visualizar, editar, anotar, mesclar,
            dividir e assinar arquivos PDF para finalidades pessoais, acadêmicas ou corporativas.
          </p>
          <div className="legal-example">
            <strong>Exemplo:</strong> Um profissional autônomo pode organizar comprovantes e faturas, ou
            um estudante pode juntar capítulos de uma apostila de estudos sem cobrança de taxas ou limites
            artificiais de uso.
          </div>
        </section>

        <section className="legal-section">
          <h3>2. Responsabilidade pelo Conteúdo</h3>
          <p>
            Você é o único responsável pelo conteúdo inserido, modificado ou assinado nos documentos. O
            aplicativo não monitora nem tem acesso aos seus arquivos.
          </p>
          <div className="legal-example">
            <strong>Exemplo:</strong> É expressamente proibido utilizar a ferramenta para falsificação
            de assinaturas, alteração indevida de dados oficiais ou violação de direitos autorais de
            terceiros.
          </div>
        </section>

        <section className="legal-section">
          <h3>3. Salvamento e Prevenção de Perdas</h3>
          <p>
            Como os arquivos são processados na memória local do seu navegador, é responsabilidade do
            usuário exportar o documento editado ou salvá-lo no Google Drive.
          </p>
          <div className="legal-example">
            <strong>Exemplo:</strong> Se a aba do navegador for fechada ou o computador for reiniciado
            antes de clicar em "Salvar" ou "Exportar PDF", as edições não finalizadas não poderão ser
            recuperadas por nós.
          </div>
        </section>

        <section className="legal-section">
          <h3>4. Disponibilidade e Isenção de Garantias</h3>
          <p>
            O software é fornecido "no estado em que se encontra" (as-is), sem garantias implícitas de
            infalibilidade técnica. Buscamos manter máxima compatibilidade com os padrões PDF internacionais.
          </p>
          <div className="legal-example">
            <strong>Exemplo:</strong> Recomendamos sempre manter um backup do seu arquivo PDF original
            antes de realizar edições extensas ou remoções de páginas.
          </div>
        </section>
      </div>
      <div className="modal-actions">
        <button type="button" className="button is-primary" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Modal>
  );
}
