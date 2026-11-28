# E-mails do Supabase Auth

Cole o HTML em **Authentication → Emails → Templates** do Supabase:

- `confirm-signup.html` → template **Confirm sign up** (assunto sugerido: "Confirme seu e-mail no ZernFlow")
- `recovery.html` → template **Reset password** (assunto sugerido: "Crie uma nova senha no ZernFlow")

Os botões apontam para `{{ .SiteURL }}/auth/confirm` (rota em `app/auth/confirm/route.ts`):
confirmação de e-mail termina em `/login?confirmed=1`; recuperação termina em `/reset-password`.
Para funcionar, o **Site URL** (Authentication → URL Configuration) precisa ser o endereço do app.
