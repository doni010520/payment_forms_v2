-- Adiciona 'comentario' como status válido nas anotações de campo e documento.
-- Comentario = nota neutra, sem severidade. Usado quando o operador quer
-- apenas registrar uma observação sem julgar como verificado/duvida/problema.

ALTER TABLE anotacoes_envio DROP CONSTRAINT IF EXISTS anotacoes_envio_status_check;
ALTER TABLE anotacoes_envio ADD CONSTRAINT anotacoes_envio_status_check
  CHECK (status IN ('verificado','duvida','problema','comentario'));

ALTER TABLE anotacoes_documento DROP CONSTRAINT IF EXISTS anotacoes_documento_status_check;
ALTER TABLE anotacoes_documento ADD CONSTRAINT anotacoes_documento_status_check
  CHECK (status IN ('verificado','duvida','problema','comentario'));
