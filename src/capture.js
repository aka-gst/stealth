/**
 * Неподвижный кадр для витрины.
 *
 * Адрес — не часть игры: он только ставит уже существующую сцену и убирает
 * всё, что могло бы испортить снимок или оставить след у человека.
 */
export function isShotURL(search = '') {
    try { return new URLSearchParams(search).get('кадр') === '1'; }
    catch { return false; }
}

export function startShot({ search, hideHud, freezeInput, scene }) {
    if (!isShotURL(search)) return false;
    hideHud();
    freezeInput();
    scene({ close: true, scale: 3.2 });
    return true;
}
