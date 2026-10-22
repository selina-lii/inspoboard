# Formula demo results

Made on 2026-10-11 with the new plugin `plugins/mathocr` (Rust, ONNX Runtime, Pix2Text 1.5 models; no Python) and the plugin `plugins/math` (Speech Rule Engine). The images are the files in this folder.

## 1. Images → LaTeX (plugins/mathocr)

D = a formula on its own line, i = a formula in a line of text. The number is the detection score.

### 5b860b9b8a03-20220608.png (1.0 s)

- D 0.87: `\mathrm{Attention} ( Q , K , V )=\mathrm{softmax} ( \cfrac{Q K^{T}} {\sqrt{d_{k}}} ) V`

### ReflectionEquation.png (6.6 s)

- D 0.94: `\begin{aligned} {\mathbb E_{y^{*}} \left[ p ( \theta\mid y^{*} ) \right]} & {{}=\mathbb E_{y^{*}} \left[ p ( \theta) \, \frac{p ( y^{*} \mid\theta )} {p ( y^{*} )} \right]} \\ {} & {{}=p ( \theta) \, \mathbb E_{y^{*}} \left[ \frac{p ( y^{*} \mid\theta )} {p ( y^{*} )} \right]} \\ {} & {{}=p ( \theta) \sum_{\imath} \frac{p ( y_{\imath}^{*} \mid\theta )} {p ( y_{\imath}^{*} )} \, p ( y_{\imath}^{*} )=p ( \theta) \sum_{\imath} \frac{p ( y_{\imath}^{*} \mid\theta )} {p ( y_{\imath}^{*} )} \, p ( y_{\imath}^{*} )} \\ {} & {{}=p ( \theta) \sum_{\imath} p ( y_{\imath}^{*} \mid\theta )} \\ {} & {{}=p ( \theta) .} \\ \end{aligned}`

### Screen_Shot_2017-01-06_at_5.10.09_PM.png (9.9 s)

- D 0.93: `\iiint_{V} f ( x , y , z ) \, d V=F`
- D 0.93: `\frac{d x} {d y}=x^{\prime}=\operatorname*{lim}_{h \to0} \frac{f ( x+h )-f ( x )} {h}`
- D 0.94: `| x |=\begin{cases} {-x ,} & {\mathrm{if~} x < 0} \\ {x ,} & {\mathrm{if~} x \geq0} \\ \end{cases}`
- D 0.94: `F ( x )=A_{0}+\sum_{n=1}^{N} \left[ A_{n} \operatorname{cos} \left( \frac{2 \pi n x} {P} \right)+B_{n} \operatorname{sin} \left( \frac{2 \pi n x} {P} \right) \right]`
- D 0.92: `\sum_{n} \frac{1} {n^{s}}=\prod_{p} \frac{1} {1-\frac{1} {p^{s}}}`
- D 0.91: `m \ddot{x}+c \dot{x}+k x=F_{0} \operatorname{sin} ( 2 \pi f t )`
- D 0.93: `\begin{array} {l l l} {f ( x )} & {=} & {x^{2}+3 x+5 x^{2}+8+6 x} \\ {} & {=} & {6 x^{2}+9 x+8} \\ {} & {=} & {x ( 6 x+9 )+8} \\ \end{array}`
- D 0.94: `X={\frac{F_{0}} {k}} {\frac{1} {\sqrt{( 1-r^{2} )^{2}+( 2 \zeta r )^{2}}}}`
- D 0.93: `G_{\mu\nu} \equiv R_{\mu\nu}-\frac{1} {2} R g_{\mu\nu}=\frac{8 \pi G} {c^{4}} T_{\mu\nu}`
- D 0.88: `6 \mathrm{C O_{2}}+6 \mathrm{H_{2} O} \to\mathrm {C_{6} H_{1 2} O_{6}}+6 \mathrm{O_{2}}`
- D 0.88: `\mathrm{S O_{4}^{2-}+B a^{2+} \to B a S O_{4}}`
- D 0.94: `\left( \begin{matrix} {a_{1 1}} & {a_{1 2}} & {\dots} & {a_{1 n}} \\ {a_{2 1}} & {a_{2 2}} & {\dots} & {a_{2 n}} \\ {\vdots} & {\vdots} & {\ddots} & {\vdots} \\ {a_{n 1}} & {a_{n 2}} & {\dots} & {a_{n n}} \\ \end{matrix} \right) \left( \begin{matrix} {v_{1}} \\ {v_{2}} \\ {\vdots} \\ {v_{n}} \\ \end{matrix} \right)=\left( \begin{matrix} {w_{1}} \\ {w_{2}} \\ {\vdots} \\ {w_{n}} \\ \end{matrix} \right)`
- D 0.88: `\frac{\partial\mathbf {u}} {\partial t}+( \mathbf{u} \cdot\nabla ) \mathbf{u}-\nu\nabla^{2} ( \mathbf{u} )=- \nabla\mathbf {h}`
- D 0.88: `\alpha A \beta B \gamma\Gamma \delta\Delta \pi\Pi \omega\Omega`

### ep05im09.png (3.1 s)

- D 0.95: `\begin{aligned} {V} & {{}=\iiint\rho^{2} s i n \theta d \rho d \theta d \varphi} \\ {} & {{}=\int_{0}^{2 \pi} \int_{0}^{\pi} \int_{0}^{r} \rho^{2} \operatorname{sin} \theta d \rho d \theta d \varphi} \\ {} & {{}=2 \pi\int_{0}^{\pi} \int_{0}^{r} \rho^{2} \operatorname{sin} \theta d \rho d \theta} \\ {} & {{}=4 \pi\int_{0}^{r} \rho^{2} d \rho} \\ {} & {{}=\frac{4 \pi} {3} \rho^{3}} \\ \end{aligned}`

### giI9K.png (13.2 s)

- D 0.89: `F ( \frac{\beta. \xi. q} {1-\alpha} ) . ( \int_{0}^{\frac{q} {\alpha}} ( q-\alpha N ) . f ( N ) d N )+\left[ 1-F ( \frac{\beta. \xi. q} {1-\alpha} ) \right] . ( \int_{0}^{q ( 1+\beta. \xi)} [ q-( N-\beta\xi q ) ] f ( N ) d N )=F ( \frac{\beta. \xi. q} {1-\alpha} ) .`
- D 0.91: `\begin{aligned} {{}} & {{} F \left( \frac{\beta\xi q} {1-\alpha} \right) \int_{0}^{\frac{q} {\alpha}} ( q-\alpha N ) f ( N ) d N} \\ {{}} & {{} \qquad\qquad \qquad+\left[ 1-F \left( \frac{\beta\xi q} {1-\alpha} \right) \right] \int_{0}^{q ( 1+\beta\xi )} \left[ q-( N-\beta\xi q ) \right] f ( N ) d N} \\ {{}} & {{}=F \left( \frac{\beta\xi q} {1-\alpha} \right) q \left( F \left( \frac{q} {\alpha} \right)-\alpha\int_{0}^{\frac{q} {\alpha}} N f ( N ) d N \right)} \\ {{}} & {{}+\left[ 1-F ( \frac{\beta\xi q} {1-\alpha} ) \right] q ( 1+\beta\xi ) \left( F \left( q ( 1+\beta\xi ) \right)-\int_{0}^{q ( 1+\beta\xi )} N f ( N ) d N \right) .} \\ \end{aligned}`
- D 0.89: `\begin{array} {l} {{F \left( \frac{\beta\xi q} {1-\alpha} \right) \int_{0}^{\frac{q} {\alpha}} ( q-\alpha N ) f ( N ) d N}} \\ {{\qquad\qquad \qquad\qquad+\left[ 1-F \left( \frac{\beta\xi q} {1-\alpha} \right) \right] \int_{0}^{q+\beta\xi q} \left[ q-( N-\beta\xi q ) \right] f ( N ) d N}} \\ {{=F \left( \frac{\beta\xi q} {1-\alpha} \right) q \left( F \left( \frac{q} {\alpha} \right)-\alpha\int_{0}^{\frac{\pi} {\alpha}} N f ( N ) d N \right)}} \\ {{\qquad\qquad+\left[ 1-F ( \frac{\beta\xi q} {1-\alpha} ) \right] q ( 1+\beta\xi ) \left( F \left( q+\beta\xi q \right)-\int_{0}^{q+\beta\xi q} N f ( N ) d N \right) .}} \end{array}`

### maxresdefault.jpg (2.3 s)

- D 0.45: `\mathrm{Mathematical~Equations~in~ETpeX}`
- D 0.86: `a^{2}+b^{2}=c^{2}`
- D 0.71: `f ( x )=\operatorname{sin} x+\operatorname{cos} x`
- D 0.55: `\begin{aligned} {\mathrm{Let~} A=\left( \begin{matrix} {1} & {2} \\ {3} & {4} \\ \end{matrix} \right)} & {{} . \mathrm{~Then~det~} A=?} \\ {} & {{} X \cup Y=X \cap Z=A \oplus B=X \odot Y} \\ {} & {{} \alpha+\beta+\gamma=\Delta+\xi-\varepsilon} \\ \end{aligned}`

### preview-en.jpg (3.2 s)

- i 0.32: `\textcircled{C} \circ\textcircled {C}`
- i 0.30: `\leftarrow\rightarrow \mathbf{C}`
- i 0.27: `\lambda=\frac{1} {2} \vdots`
- i 0.80: `f ( x )`
- i 0.50: `\frac{[ \phantom{+} ]} {[ \phantom{+} ]}`
- i 0.74: `\int_{[-1 ]}^{[-1 ]}`
- i 0.75: `\sum_{[ ]}^{[ ]}`
- i 0.62: `\operatorname{sin} [ \mathbf{\xi}_{\mathbf{\xi}} ]`
- i 0.81: `\langle/ \rangle`
- i 0.41: `\div\; \mid< \; \ll>`
- i 0.32: `\vee`
- i 0.28: `\vee`
- i 0.26: `\vee`
- i 0.26: `r`
- i 0.40: `\vee`
- i 0.35: `\vee`
- i 0.30: `\vee`
- D 0.93: `( x \!+\! a )^{2} \!=\! \overset{n} {\underset{k \!=0} {\sum}} \! \binom{n} {k} x^{k} a^{n-k}`

### rectangle_large_type_2_1d986b154fcec2c1efb7907608cf4cde.webp (13.3 s)

- D 0.80: `\begin{cases} {\widetilde{\mathcal{L}}^{\mathrm{L}}=i ( \bar{\mathbf{\Psi}}_{l}^{\mathrm{L}} D \! \! \! \! D \Psi_{l}^{\mathrm{L}}+\bar{\psi}_{l}^{\mathrm{R}} D \! \! \! \! D \psi_{l}^{\mathrm{R}}+\bar{\psi}_{\nu_{l}}^{\mathrm{R}} D \! \! \! \! D \psi_{\nu_{l}}^{\mathrm{R}} )} \\ {\mathcal{L}^{\mathrm{B}}=- \frac{1} {4} B_{\mu\nu} B^{\mu\nu}-\frac{1} {4} W_{i \mu\nu} W_{i}^{\mu\nu}} \\ {\mathcal{L}^{\mathrm{H}}=( D^{\mu} \mathbf{\Phi} )^{\dagger} ( D_{\mu} \mathbf{\Phi} )-\mu^{2} \mathbf{\Phi}^{\dagger} \mathbf{\Phi}-\lambda( \mathbf{\Phi}^{\dagger} \mathbf{\Phi} )^{2}} \\ {\mathcal{L}^{\mathrm{LH}}=- g_{l} ( \bar{\mathbf{\Psi}}_{l}^{\mathrm{L}} \psi_{l}^{\mathrm{R}} \mathbf{\Phi}+\mathbf{\Phi}^{\dagger} \bar{\psi}_{l}^{\mathrm{R}} \mathbf{\Psi}_{l}^{\mathrm{L}} )-g_{\nu_{l}} ( \mathbf{\bar{\Psi}}_{l}^{\mathrm{L}} \psi_{\nu_{l}}^{\mathrm{R}} \mathbf{\tilde{\Phi}}+\mathbf{`

## 2. LaTeX → words: Speech Rule Engine (in the app now) and MathCAT

The same MathML for each. SRE = Speech Rule Engine (plugins/math). MathCAT is a Rust library (also used by NVDA).

### Attention

`\mathrm{Attention}(Q,K,V)=\mathrm{softmax}\left(\frac{QK^{T}}{\sqrt{d_{k}}}\right)V`

- **SRE ClearSpeak (default):** Attention of open paren Q comma K comma V close paren equals softmax of open paren the fraction with numerator Q K to the T power and denominator the square root of d sub k close paren V
- **SRE MathSpeak:** upper A t t e n t i o n left parenthesis upper Q comma upper K comma upper V right parenthesis equals softmax left parenthesis StartFraction upper Q upper K Superscript upper T Baseline Over StartRoot d Subscript k Baseline EndRoot EndFraction right parenthesis upper V
- **MathCAT ClearSpeak:** Attention of; open paren,  cap q comma,  cap k comma,  cap v; close paren; is equal to; softmax of; open paren; the fraction with numerator;  cap q  cap k transpose; and denominator the square root of d sub k; close paren;  cap v
- **MathCAT SimpleSpeak:** Attention of; open paren,  cap q comma,  cap k comma,  cap v; close paren; is equal to; softmax of; open paren; fraction,  cap q  cap k transpose, over, the square root of d sub k; end root; end fraction; close paren;  cap v

### Sphere volume

`V=\int_{0}^{2\pi}\int_{0}^{\pi}\int_{0}^{r}\rho^{2}\sin\theta\,d\rho\,d\theta\,d\varphi`

- **SRE ClearSpeak (default):** V equals the integral from 0 to 2 pi of the integral from 0 to pi of the integral from 0 to r of rho squared the sine of theta times d rho times d theta times d phi
- **SRE MathSpeak:** upper V equals integral Subscript 0 Superscript 2 pi Baseline integral Subscript 0 Superscript pi Baseline integral Subscript 0 Superscript r Baseline rho squared sine theta d rho d theta d phi
- **MathCAT ClearSpeak:** cap v is equal to; the integral from 0 to 2 pi of; the integral from 0 to pi of; the integral from 0 to r of; rho squared; sine of; theta d rho d theta d phi
- **MathCAT SimpleSpeak:** cap v is equal to; the integral from 0 to 2 pi of; the integral from 0 to pi of; the integral from 0 to r of; rho squared; sine of; theta d rho d theta d phi

### Bayes

`\mathbb E_{g^{*}}\left[p(\theta\mid y^{*})\right]=\mathbb E_{g^{*}}\left[p(\theta)\,\frac{p(y^{*}\mid\theta)}{p(y^{*})}\right]`

- **SRE ClearSpeak (default):** double struck E sub the asterisk power of g of open bracket p of open paren theta divides y raised to the asterisk power close paren close bracket equals double struck E sub the asterisk power of g of open bracket p of theta the fraction with numerator p of open paren y raised to the asterisk power divides theta close paren and denominator p of open paren y raised to the asterisk power close paren close bracket
- **SRE MathSpeak:** double struck upper E Subscript g Sub Superscript asterisk Baseline left bracket p left parenthesis theta vertical bar y Superscript asterisk Baseline right parenthesis right bracket equals double struck upper E Subscript g Sub Superscript asterisk Baseline left bracket p left parenthesis theta right parenthesis StartFraction p left parenthesis y Superscript asterisk Baseline vertical bar theta right parenthesis Over p left parenthesis y Superscript asterisk Baseline right parenthesis EndFraction right bracket
- **MathCAT ClearSpeak:** double struck  cap e sub g superscript times,  end sub; open bracket; p; open paren, theta divides y superscript times; close paren; close bracket; is equal to; double struck  cap e sub g superscript times,  end sub; open bracket; p of theta; the fraction with numerator; p; open paren, y superscript times; divides theta; close paren; and denominator p of, open paren, y superscript times; close paren; close bracket
- **MathCAT SimpleSpeak:** double struck  cap e sub g superscript times,  end sub; open bracket; p; open paren, theta divides y superscript times; close paren; close bracket; is equal to; double struck  cap e sub g superscript times,  end sub; open bracket; p of theta; fraction, p; open paren, y superscript times; divides theta; close paren, over, p of, open paren, y superscript times; close paren, end fraction; close bracket

### Navier-Stokes

`\frac{\partial\mathbf{u}}{\partial t}+(\mathbf{u}\cdot\nabla)\mathbf{u}-\nu\nabla^{2}(\mathbf{u})=-\nabla\mathbf{h}`

- **SRE ClearSpeak (default):** the fraction with numerator partial differential bold u and denominator partial differential t plus open paren bold u times nabla close paren times bold u minus nu nabla squared bold u equals negative nabla bold h
- **SRE MathSpeak:** StartFraction partial differential bold u Over partial differential t EndFraction plus left parenthesis bold u dot nabla right parenthesis bold u minus nu nabla squared left parenthesis bold u right parenthesis equals minus nabla bold h
- **MathCAT ClearSpeak:** the fraction with numerator; partial derivative bold u; and denominator partial derivative t; plus; open paren, bold u dot product nahblah, close paren; times bold u; minus, nu lahplahsian of bold u; is equal to, negative gradient of bold h
- **MathCAT SimpleSpeak:** fraction, partial derivative bold u, over, partial derivative t, end fraction; plus; open paren, bold u dot product nahblah, close paren; times bold u; minus, nu lahplahsian of bold u; is equal to, negative gradient of bold h

### Binomial

`(x+a)^{n}=\sum_{k=0}^{n}\binom{n}{k}x^{k}a^{n-k}`

- **SRE ClearSpeak (default):** open paren x plus a close paren to the n-th power equals the sum from k equals 0 to n of the 2 by 1 column matrix n k times x to the k-th power a raised to the n minus k power
- **SRE MathSpeak:** left parenthesis x plus a right parenthesis Superscript n Baseline equals sigma summation Underscript k equals 0 Overscript n Endscripts StartBinomialOrMatrix n Choose k EndBinomialOrMatrix x Superscript k Baseline a Superscript n minus k
- **MathCAT ClearSpeak:** open paren x plus eigh, close paren to the n-th power; is equal to; the sum from k is equal to 0 to n of; n choose k x to the k-th power, times, eigh raised to the n minus k power
- **MathCAT SimpleSpeak:** open paren x plus eigh, close paren to the n-th; is equal to; the sum from k is equal to 0 to n of; n choose k x to the k-th times, eigh raised to the n minus k power

### Pythagoras

`a^{2}+b^{2}=c^{2}`

- **SRE ClearSpeak (default):** a squared plus b squared equals c squared
- **SRE MathSpeak:** a squared plus b squared equals c squared
- **MathCAT ClearSpeak:** eigh squared plus b squared, is equal to c squared
- **MathCAT SimpleSpeak:** eigh squared plus b squared, is equal to c squared

### Quadratic

`x=\frac{-b\pm\sqrt{b^{2}-4ac}}{2a}`

- **SRE ClearSpeak (default):** x equals the fraction with numerator negative b plus or minus the square root of b squared minus 4 a c and denominator 2 a
- **SRE MathSpeak:** x equals StartFraction negative b plus or minus StartRoot b squared minus 4 a c EndRoot Over 2 a EndFraction
- **MathCAT ClearSpeak:** x is equal to; the fraction with numerator; negative b plus or minus; the square root of b squared minus 4 eigh c; and denominator 2 eigh
- **MathCAT SimpleSpeak:** x is equal to; fraction, negative b plus or minus; the square root of b squared minus 4 eigh c, end root; over, 2 eigh, end fraction

### Matrix det

`\det\begin{pmatrix}1&2\\3&4\end{pmatrix}=-2`

- **SRE ClearSpeak (default):** the determinant of the 2 by 2 matrix Row 1: 1 2 Row 2: 3 4 equals negative 2
- **SRE MathSpeak:** det Start 2 By 2 Matrix 1st Row 1st Column 1 2nd Column 2 2nd Row 1st Column 3 2nd Column 4 EndMatrix equals negative 2
- **MathCAT ClearSpeak:** det of, the 2 by 2 matrix; row 1; 1, 2; row 2; 3, 4; is equal to negative 2
- **MathCAT SimpleSpeak:** det of, the 2 by 2 matrix; row 1; 1, 2; row 2; 3, 4; is equal to negative 2

### Limit

`\lim_{n\to\infty}\left(1+\frac{1}{n}\right)^{n}=e`

- **SRE ClearSpeak (default):** lim over n right arrow normal infinity of open paren 1 plus 1 over n close paren to the n-th power equals e
- **SRE MathSpeak:** limit Underscript n right arrow normal infinity Endscripts left parenthesis 1 plus StartFraction 1 Over n EndFraction right parenthesis Superscript n Baseline equals e
- **MathCAT ClearSpeak:** the limit as n approaches infinity, of, open paren, 1 plus 1 over n, close paren to the n-th power; is equal to e
- **MathCAT SimpleSpeak:** the limit as n approaches infinity, of, open paren, 1 plus 1 over n; close paren to the n-th; is equal to e

### Set

`X\cup Y=\{x\in\mathbb{R}\mid x>0\}`

- **SRE ClearSpeak (default):** X union Y equals the set of all x in the real numbers such that x is greater than 0
- **SRE MathSpeak:** upper X union upper Y equals StartSet x element of double struck upper R vertical bar x greater than 0 EndSet
- **MathCAT ClearSpeak:** cap x union  cap y, is equal to; the set x in, the real numbers divides x is greater than 0
- **MathCAT SimpleSpeak:** cap x union  cap y, is equal to; the set x an element of, the real numbers divides x is greater than 0

## Summary

- MathCAT is better at: limits ("the limit as n approaches infinity"), binomials ("n choose k"), the derivative words ("partial derivative", "gradient", "transpose").
- SRE is better at: clean text for the screen (MathCAT writes sounds for the speech engine: "eigh" for a, "nahblah" for nabla, "cap q", semicolons as pauses), sets ("the set of all x … such that"), and `y^*` (MathCAT says "superscript times").
- Both say `\mid` as "divides" (wrong in probability).
- Decision for now: keep SRE (the notes show the words on the screen). MathCAT can be a second choice later.
