/**
 * MÃ³dulo de procesamiento y optimizaciÃ³n de imÃ¡genes en cliente para CommerCity.
 * Regla:
 * 1. Rechaza archivos que superen 5MB (o maxMB especificado).
 * 2. Convierte automÃ¡ticamente cualquier imagen (PNG, JPG, WEBP) a formato .webp vÃ­a HTML5 Canvas.
 */

export async function processImageFileToWebP(file, maxMB = 5, quality = 0.85) {
  if (!file) {
    throw new Error('No se seleccionÃ³ ningÃºn archivo de imagen.');
  }

  // Validar tipos de entrada permitidos
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedMimes.includes(file.type)) {
    throw new Error('El archivo seleccionado debe ser una imagen vÃ¡lida (JPG, PNG o WEBP).');
  }

  // Validar lÃ­mite mÃ¡ximo de tamaÃ±o
  const maxBytes = maxMB * 1024 * 1024;
  const originalSizeMB = (file.size / (1024 * 1024)).toFixed(2);

  if (file.size > maxBytes) {
    throw new Error(`El archivo supera el tamaÃ±o mÃ¡ximo permitido de ${maxMB}MB (TamaÃ±o actual: ${originalSizeMB}MB).`);
  }

  // Convertir a WebP con Canvas HTML5
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      // Redimensionamiento defensivo proporcional (Max 2560px)
      const MAX_DIMENSION = 2560;
      let targetWidth = img.naturalWidth || img.width || 800;
      let targetHeight = img.naturalHeight || img.height || 600;

      if (targetWidth > MAX_DIMENSION || targetHeight > MAX_DIMENSION) {
        if (targetWidth > targetHeight) {
          targetHeight = Math.round((targetHeight * MAX_DIMENSION) / targetWidth);
          targetWidth = MAX_DIMENSION;
        } else {
          targetWidth = Math.round((targetWidth * MAX_DIMENSION) / targetHeight);
          targetHeight = MAX_DIMENSION;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return reject(new Error('No fue posible inicializar el contexto de imagen para procesar el archivo.'));
      }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      try {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              return reject(new Error('La conversiÃ³n de la imagen fallÃ³ y retornÃ³ un resultado vacÃ­o.'));
            }

            const cleanName = file.name.replace(/\.[^/.]+$/, '');
            const webpName = `${cleanName}.webp`;
            const webpFile = new File([blob], webpName, {
              type: 'image/webp',
              lastModified: Date.now(),
            });
            const webpSizeMB = (blob.size / (1024 * 1024)).toFixed(2);

            const reader = new FileReader();
            reader.onloadend = () => {
              resolve({
                file: webpFile,
                dataUrl: reader.result,
                originalName: file.name,
                webpName: webpName,
                originalSizeMB: parseFloat(originalSizeMB),
                webpSizeMB: parseFloat(webpSizeMB),
              });
            };
            reader.onerror = () => reject(new Error('Error leyendo vista previa de la imagen final.'));
            reader.readAsDataURL(webpFile);
          },
          'image/webp',
          quality
        );
      } catch (err) {
        reject(new Error('OcurriÃ³ un error inesperado al convertir la imagen a formato WebP.'));
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('No se pudo leer la imagen seleccionada o el formato es corrupto.'));
    };

    img.src = objectUrl;
  });
}
