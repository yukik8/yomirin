-- セッションの行に、その回の Chrome のメジャー版を足す(#45・行の形の版 2)。
-- tm_installs.chrome は最後に届いた hello で上書きされるので、昔の回の環境を調べるには回ごとに要る。
-- いままでの行と、前の版の拡張(行の形の版 1)から届く行は null のまま。
ALTER TABLE tm_sessions ADD COLUMN IF NOT EXISTS chrome smallint;  -- その回の Chrome のメジャー版
