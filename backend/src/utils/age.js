function isAdult(fechaNacimiento, referenceDate = new Date()) {
  if (!fechaNacimiento) return false;

  const birthDate = new Date(fechaNacimiento);
  if (isNaN(birthDate.getTime())) return false;

  const refDate = new Date(referenceDate);
  if (isNaN(refDate.getTime())) return false;

  if (birthDate > refDate) return false;

  let age = refDate.getFullYear() - birthDate.getFullYear();
  const m = refDate.getMonth() - birthDate.getMonth();

  if (m < 0 || (m === 0 && refDate.getDate() < birthDate.getDate())) {
    age--;
  }

  return age >= 18;
}

module.exports = {
  isAdult
};
