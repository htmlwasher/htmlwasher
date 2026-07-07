// SPDX-License-Identifier: Apache-2.0
//! Pure-Rust GBDT evaluator over the XGBoost native JSON dump (`multi:softprob`,
//! 7 classes, 1400 trees, round-robin `tree_info[i] == i % 7`).
//!
//! Node arrays per tree: `left_children`, `right_children`, `split_indices`,
//! `split_conditions`, `default_left`. LEAF where `left_children[i] == -1` → weight =
//! `split_conditions[i]`. INTERNAL: feature = `split_indices[i]`, threshold =
//! `split_conditions[i]`; strict `<` → LEFT, `>=` → RIGHT; missing/NaN/out-of-range
//! feature → `default_left` routing (present but never set here — dense features).
//! `base_score` (0.5) is a single scalar added equally to all class margins → cancels
//! under softmax, so margins accumulate from 0.

use serde::Deserialize;

use crate::error::Error;

#[derive(Deserialize)]
struct RawModel {
    learner: RawLearner,
}

#[derive(Deserialize)]
struct RawLearner {
    learner_model_param: RawParam,
    gradient_booster: RawBooster,
}

#[derive(Deserialize)]
struct RawParam {
    num_class: String,
}

#[derive(Deserialize)]
struct RawBooster {
    model: RawGbModel,
}

#[derive(Deserialize)]
struct RawGbModel {
    tree_info: Vec<i32>,
    trees: Vec<RawTree>,
}

#[derive(Deserialize)]
struct RawTree {
    left_children: Vec<i32>,
    right_children: Vec<i32>,
    split_indices: Vec<i32>,
    split_conditions: Vec<f64>,
    default_left: Vec<u8>,
}

/// A single decision tree in flat-array form.
struct Tree {
    left: Vec<i32>,
    right: Vec<i32>,
    feature: Vec<i32>,
    threshold: Vec<f64>,
    default_left: Vec<bool>,
}

impl Tree {
    /// Walk to a leaf and return its weight. Guarded against cycles/out-of-range nodes
    /// (returns 0.0 rather than looping or panicking).
    fn eval(&self, features: &[f64]) -> f64 {
        let n = self.left.len();
        let mut node = 0usize;
        for _ in 0..=n {
            let (Some(&left), Some(&right), Some(&feat), Some(&thr), Some(&dleft)) = (
                self.left.get(node),
                self.right.get(node),
                self.feature.get(node),
                self.threshold.get(node),
                self.default_left.get(node),
            ) else {
                return 0.0;
            };
            if left == -1 {
                return thr; // leaf weight = split_conditions[node]
            }
            // XGBoost evaluates splits in float32 (features are stored as f32 in the
            // DMatrix, thresholds are f32). Comparing in f64 would branch differently
            // for a feature value near a threshold — matching float32 is required for
            // probability parity (argmax is unaffected, but probs shift by up to ~0.3).
            let go_left = match usize::try_from(feat).ok().and_then(|i| features.get(i)) {
                Some(&v) if !v.is_nan() => (v as f32) < (thr as f32),
                _ => dleft, // missing / NaN / out-of-range → default_left routing
            };
            let next = if go_left { left } else { right };
            match usize::try_from(next) {
                Ok(i) => node = i,
                Err(_) => return 0.0,
            }
        }
        0.0 // cycle guard
    }
}

/// The parsed gradient-boosted forest.
pub struct Gbdt {
    trees: Vec<Tree>,
    tree_class: Vec<usize>,
    num_class: usize,
}

impl Gbdt {
    /// Parse the XGBoost native JSON dump.
    ///
    /// # Errors
    /// Returns [`Error::ModelLoad`] when the JSON is malformed, `num_class` is not a
    /// positive integer, or `tree_info`/tree arrays are inconsistent.
    pub fn parse(json: &str) -> Result<Self, Error> {
        let raw: RawModel =
            serde_json::from_str(json).map_err(|e| Error::ModelLoad(format!("model json: {e}")))?;
        let num_class: usize = raw
            .learner
            .learner_model_param
            .num_class
            .parse()
            .map_err(|_| Error::ModelLoad("num_class not an integer".to_string()))?;
        if num_class == 0 {
            return Err(Error::ModelLoad("num_class must be > 0".to_string()));
        }
        let model = raw.learner.gradient_booster.model;
        if model.tree_info.len() != model.trees.len() {
            return Err(Error::ModelLoad(
                "tree_info/trees length mismatch".to_string(),
            ));
        }

        let mut trees = Vec::with_capacity(model.trees.len());
        for t in model.trees {
            let n = t.left_children.len();
            if t.right_children.len() != n
                || t.split_indices.len() != n
                || t.split_conditions.len() != n
                || t.default_left.len() != n
            {
                return Err(Error::ModelLoad(
                    "tree node array length mismatch".to_string(),
                ));
            }
            trees.push(Tree {
                left: t.left_children,
                right: t.right_children,
                feature: t.split_indices,
                threshold: t.split_conditions,
                default_left: t.default_left.into_iter().map(|d| d != 0).collect(),
            });
        }

        let mut tree_class = Vec::with_capacity(model.tree_info.len());
        for c in model.tree_info {
            let cls = usize::try_from(c)
                .map_err(|_| Error::ModelLoad("negative tree_info entry".to_string()))?;
            if cls >= num_class {
                return Err(Error::ModelLoad("tree_info class out of range".to_string()));
            }
            tree_class.push(cls);
        }

        Ok(Self {
            trees,
            tree_class,
            num_class,
        })
    }

    /// The number of classes.
    #[must_use]
    pub fn num_class(&self) -> usize {
        self.num_class
    }

    /// Predict class probabilities for a feature vector: round-robin accumulate
    /// per-class margins → softmax → `(argmax_index, probabilities)`.
    #[must_use]
    pub fn predict(&self, features: &[f64]) -> (usize, Vec<f64>) {
        let mut margins = vec![0.0_f64; self.num_class];
        for (i, tree) in self.trees.iter().enumerate() {
            let leaf = tree.eval(features);
            if let Some(cls) = self.tree_class.get(i) {
                if let Some(m) = margins.get_mut(*cls) {
                    *m += leaf;
                }
            }
        }

        let max = margins.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let exps: Vec<f64> = margins.iter().map(|m| (m - max).exp()).collect();
        let sum: f64 = exps.iter().sum();
        let probs: Vec<f64> = if sum > 0.0 {
            exps.iter().map(|e| e / sum).collect()
        } else {
            vec![0.0; self.num_class]
        };

        let mut best_idx = 0;
        let mut best = f64::NEG_INFINITY;
        for (i, &p) in probs.iter().enumerate() {
            if p > best {
                best = p;
                best_idx = i;
            }
        }
        (best_idx, probs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Tree 0 (class 0): feature0 < 0.5 → leaf 1.0, else leaf -1.0. Tree 1 (class 1): leaf 0.0.
    const TINY: &str = r#"{"learner":{"learner_model_param":{"num_class":"2"},
        "gradient_booster":{"model":{"tree_info":[0,1],"trees":[
          {"left_children":[1,-1,-1],"right_children":[2,-1,-1],"split_indices":[0,0,0],
           "split_conditions":[0.5,1.0,-1.0],"default_left":[0,0,0]},
          {"left_children":[-1],"right_children":[-1],"split_indices":[0],
           "split_conditions":[0.0],"default_left":[0]}]}}}}"#;

    #[test]
    fn routes_and_accumulates_per_class() {
        let gbdt = Gbdt::parse(TINY).expect("parse");
        assert_eq!(gbdt.num_class(), 2);
        // 0.0 < 0.5 → class-0 margin 1.0 → argmax 0.
        assert_eq!(gbdt.predict(&[0.0]).0, 0);
        // 1.0 >= 0.5 → class-0 margin -1.0 → argmax 1.
        assert_eq!(gbdt.predict(&[1.0]).0, 1);
    }

    #[test]
    fn split_is_strict_less_than() {
        let gbdt = Gbdt::parse(TINY).expect("parse");
        // Exactly at the threshold routes RIGHT (0.5 < 0.5 is false).
        assert_eq!(gbdt.predict(&[0.5]).0, 1);
    }

    #[test]
    fn rejects_malformed_model() {
        assert!(Gbdt::parse("not json").is_err());
        assert!(Gbdt::parse(r#"{"learner":{}}"#).is_err());
    }
}
